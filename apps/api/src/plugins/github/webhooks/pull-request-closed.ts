import { and, eq } from "drizzle-orm";
import db from "../../../database";
import { externalLinkTable } from "../../../database/schema";
import { publishEvent } from "../../../events";
import type { GitHubConfig } from "../config";
import {
  findPullRequestLinks,
  type PullRequestLinkMetadata,
  updateExternalLink,
} from "../services/link-manager";
import {
  findAllActiveGithubIntegrations,
  findTaskById,
  type TaskRow,
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
  repository: {
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
  const integrations = await findAllActiveGithubIntegrations();

  for (const integration of integrations) {
    const config = parseIntegrationConfig(integration);
    if (!config) {
      continue;
    }

    const links = await findPullRequestLinks(
      integration.id,
      pull_request.number,
      pullRequestRepo,
      repositoryFullName(config.repositoryOwner, config.repositoryName),
    );

    for (const link of links) {
      const task = await findTaskById(link.taskId);
      if (!task) {
        continue;
      }

      const existingMetadata = parseLinkMetadata<PullRequestLinkMetadata>(
        link.metadata,
        { externalLinkId: link.id, source: "pull_request_closed" },
      );

      await updateExternalLink(link.id, {
        metadata: {
          ...existingMetadata,
          state: "closed",
          merged: pull_request.merged,
          mergedAt: pull_request.merged_at,
          repository: existingMetadata.repository ?? pullRequestRepo,
        } satisfies PullRequestLinkMetadata,
      });

      let statusChanged = false;
      if (
        pull_request.merged &&
        !(await hasOtherOpenPullRequests(task, link.id))
      ) {
        statusChanged = await applyMergeTransition(
          integration.projectId,
          config,
          task,
        );
      }

      if (!statusChanged) {
        await publishEvent("task.updated", {
          taskId: task.id,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          userId: null,
        });
      }
    }
  }
}

/** Whether the task still has an open pull request, in any repository. */
async function hasOtherOpenPullRequests(
  task: TaskRow,
  closedLinkId: string,
): Promise<boolean> {
  const allTaskPRs = await db.query.externalLinkTable.findMany({
    where: and(
      eq(externalLinkTable.taskId, task.id),
      eq(externalLinkTable.resourceType, "pull_request"),
    ),
  });

  return allTaskPRs.some((pr) => {
    if (pr.id === closedLinkId) return false;
    const metadata = parseLinkMetadata<PullRequestLinkMetadata>(pr.metadata, {
      externalLinkId: pr.id,
      source: "pull_request_closed",
    });
    return metadata.state === "open";
  });
}

async function applyMergeTransition(
  projectId: string,
  config: GitHubConfig,
  task: TaskRow,
): Promise<boolean> {
  const targetStatus = await resolveTargetStatus(
    projectId,
    "pr_merged",
    config.statusTransitions?.onPRMerge || "done",
  );
  const statusResult = await updateTaskStatus(task.id, targetStatus);
  if (
    !statusResult.applied ||
    statusResult.before.status === statusResult.after.status
  ) {
    return false;
  }

  await publishEvent("task.status_changed", {
    taskId: statusResult.after.id,
    projectId: statusResult.after.projectId,
    userId: null,
    oldStatus: statusResult.before.status,
    newStatus: statusResult.after.status,
    title: statusResult.after.title,
    assigneeId: statusResult.after.userId,
    type: "status_changed",
  });
  return true;
}
