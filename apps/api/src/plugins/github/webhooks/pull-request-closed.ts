import { withIntegrationLink } from "../services/with-integration-link";
import { and, eq } from "drizzle-orm";
import { externalLinkTable } from "../../../database/schema";
import { publishEvent } from "../../../events";
import {
  findPullRequestLinks,
  type PullRequestLinkMetadata,
  updateExternalLink,
} from "../services/link-manager";
import {
  findAllIntegrationsByInstallation,
  findTaskById,
  updateTaskStatus,
} from "../services/task-service";
import { parseIntegrationConfig } from "../utils/integration-config";
import { parseLinkMetadata } from "../utils/parse-link-metadata";
import { repositoryFullName } from "../utils/repository";
import { resolveTargetStatus } from "../utils/resolve-column";

type PRClosedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    state: string;
    merged: boolean;
    merged_at: string | null;
    head: {
      ref: string;
    };
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    full_name?: string;
  };
};

export async function handlePullRequestClosed(payload: PRClosedPayload) {
  const { pull_request, repository } = payload;
  const pullRequestRepo =
    repository.full_name ??
    repositoryFullName(repository.owner.login, repository.name);

  // A pull request may be linked under several integrations (it can reference
  // issues in more than one project's repository), so every one is checked.
  const integrations = await findAllIntegrationsByInstallation(payload);

  for (const integration of integrations) {
    const config = parseIntegrationConfig(integration);
    if (!config) continue;

    const links = await findPullRequestLinks(
      integration.id,
      pull_request.number,
      pullRequestRepo,
      repositoryFullName(config.repositoryOwner, config.repositoryName),
    );

    for (const externalLink of links) {
      await withIntegrationLink(
        externalLink,
        integration,
        async (database, afterCommit, lockedLink) => {
          const task = await findTaskById(externalLink.taskId, database);

          if (!task) {
            return;
          }

          const existingMetadata = parseLinkMetadata<PullRequestLinkMetadata>(
            lockedLink.metadata,
            { externalLinkId: externalLink.id, source: "pull_request_closed" },
          );

          await updateExternalLink(
            externalLink.id,
            {
              metadata: {
                ...existingMetadata,
                state: "closed",
                merged: pull_request.merged,
                mergedAt: pull_request.merged_at,
                repository: existingMetadata.repository ?? pullRequestRepo,
              } satisfies PullRequestLinkMetadata,
            },
            database,
          );

          afterCommit(() =>
            publishEvent("task.updated", {
              projectId: integration.projectId,
              taskId: task.id,
            }),
          );

          if (!pull_request.merged) return;

          // Open pull requests in any repository keep the task where it is.
          const allTaskPRs = await database.query.externalLinkTable.findMany({
            where: and(
              eq(externalLinkTable.taskId, task.id),
              eq(externalLinkTable.resourceType, "pull_request"),
            ),
          });

          const hasOpenPRs = allTaskPRs.some((pr) => {
            if (pr.id === externalLink.id) return false;
            const metadata = parseLinkMetadata(pr.metadata, {
              externalLinkId: pr.id,
              source: "pull_request_closed",
            });
            return metadata.state === "open";
          });
          if (hasOpenPRs) return;

          const targetStatus = await resolveTargetStatus(
            integration.projectId,
            "pr_merged",
            config.statusTransitions?.onPRMerge || "done",
            database,
          );
          const statusResult = await updateTaskStatus(
            task.id,
            targetStatus,
            database,
          );
          if (
            statusResult.applied &&
            statusResult.before.status !== statusResult.after.status
          ) {
            afterCommit(() =>
              publishEvent("task.status_changed", {
                taskId: statusResult.after.id,
                projectId: statusResult.after.projectId,
                userId: null,
                oldStatus: statusResult.before.status,
                newStatus: statusResult.after.status,
                title: statusResult.after.title,
                assigneeId: statusResult.after.userId,
                type: "status_changed",
              }),
            );
          }
        },
      );
    }
  }
}
