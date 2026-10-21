import {
  type IntegrationDatabase,
  withIntegrationTask,
} from "../services/integration-task-scope";
import { publishEvent } from "../../../events";
import type { GitHubConfig } from "../config";
import {
  createExternalLink,
  findExternalLink,
  findPullRequestLinks,
  type PullRequestLinkMetadata,
  updateExternalLink,
} from "../services/link-manager";
import { resolvePullRequestTask } from "../services/resolve-pull-request-task";
import {
  findAllIntegrationsByInstallation,
  findTaskById,
  isTaskInFinalState,
  type TaskRow,
  updateTaskStatus,
} from "../services/task-service";
import { parseIntegrationConfig } from "../utils/integration-config";
import { extractIssueReferencesFromPullRequest } from "../utils/issue-reference";
import { parseLinkMetadata } from "../utils/parse-link-metadata";
import { repositoryFullName } from "../utils/repository";
import { resolveTargetStatus } from "../utils/resolve-column";

type PROpenedPayload = {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    head: {
      ref: string;
    };
    user: { login: string } | null;
  };
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
    full_name?: string;
  };
};

type Integration = Awaited<
  ReturnType<typeof findAllIntegrationsByInstallation>
>[number];

type LinkTarget = {
  integration: Integration & { project: NonNullable<Integration["project"]> };
  config: GitHubConfig;
  integrationRepo: string;
  task: TaskRow;
  /** Pull requests in the integration's own repository link one task only. */
  ownRepository: boolean;
  /** Re-resolves the task under the transaction's locks. */
  resolve: (database: IntegrationDatabase) => Promise<TaskRow | undefined>;
};

/**
 * Handles `pull_request.opened`, `reopened`, and `edited`.
 *
 * A pull request in the integration's own repository names its task by task
 * number, issue reference, or task link. A pull request in any other
 * repository of the same installation names it through the task's GitHub
 * issue instead (`owner/repo#12` or the issue URL in the branch, title, or
 * body), which is what developers already write for GitHub cross-references.
 */
export async function handlePullRequestOpened(payload: PROpenedPayload) {
  const { pull_request, repository } = payload;
  const pullRequestRepo =
    repository.full_name ??
    repositoryFullName(repository.owner.login, repository.name);

  const integrations = await findAllIntegrationsByInstallation(payload);

  const ownCandidates: LinkTarget[] = [];
  const targets: LinkTarget[] = [];
  for (const integration of integrations) {
    const project = integration.project;
    if (!project) continue;
    const config = parseIntegrationConfig(integration);
    if (!config) continue;
    const scoped = { ...integration, project };
    const integrationRepo = repositoryFullName(
      config.repositoryOwner,
      config.repositoryName,
    );

    if (config.repositoryId === repository.id) {
      const existingLinks = await findPullRequestLinks(
        integration.id,
        pull_request.number,
        pullRequestRepo,
        integrationRepo,
      );
      const resolve = (database?: IntegrationDatabase) =>
        resolvePullRequestTask({
          integrationId: integration.id,
          projectId: integration.projectId,
          projectSlug: project.slug,
          config,
          repositoryUrl: `https://github.com/${pullRequestRepo}`,
          pullRequest: pull_request,
          database,
        });
      // An already linked pull request stays on its task; only a reopen
      // refreshes that link's state.
      const linkedTask = existingLinks[0]
        ? await findTaskById(existingLinks[0].taskId)
        : await resolve();
      if (!linkedTask) continue;
      ownCandidates.push({
        integration: scoped,
        config,
        integrationRepo,
        task: linkedTask,
        ownRepository: true,
        resolve: existingLinks[0]
          ? (database) => findTaskById(linkedTask.id, database)
          : resolve,
      });
      continue;
    }

    const issueNumbers = extractIssueReferencesFromPullRequest(
      {
        branch: pull_request.head.ref,
        title: pull_request.title,
        body: pull_request.body,
      },
      config.repositoryOwner,
      config.repositoryName,
    );

    for (const issueNumber of issueNumbers) {
      const resolve = async (database?: IntegrationDatabase) => {
        const issueLink = await findExternalLink(
          integration.id,
          "issue",
          issueNumber.toString(),
          database,
        );
        return issueLink ? findTaskById(issueLink.taskId, database) : undefined;
      };
      const task = await resolve();
      if (!task) continue;
      targets.push({
        integration: scoped,
        config,
        integrationRepo,
        task,
        ownRepository: false,
        resolve,
      });
    }
  }

  // Several projects may share one repository; only an unambiguous match links.
  const ownCandidate = ownCandidates[0];
  if (ownCandidates.length === 1 && ownCandidate) targets.unshift(ownCandidate);

  for (const target of targets) {
    await linkPullRequestToTask(target, pull_request, pullRequestRepo);
  }
}

async function linkPullRequestToTask(
  target: LinkTarget,
  pullRequest: PROpenedPayload["pull_request"],
  pullRequestRepo: string,
) {
  const { integration, config, integrationRepo, task } = target;

  await withIntegrationTask(
    task.id,
    integration,
    async (database, afterCommit) => {
      const currentTask = await target.resolve(database);
      if (currentTask?.id !== task.id) return;

      const links = await findPullRequestLinks(
        integration.id,
        pullRequest.number,
        pullRequestRepo,
        integrationRepo,
        database,
      );
      const existing = links.find((link) => link.taskId === task.id);

      if (existing) {
        const metadata = parseLinkMetadata<PullRequestLinkMetadata>(
          existing.metadata,
          { externalLinkId: existing.id, source: "pull_request_opened" },
        );
        if (pullRequest.state !== "open" || metadata.state === "open") return;

        await updateExternalLink(
          existing.id,
          {
            title: pullRequest.title,
            metadata: {
              ...metadata,
              state: "open",
              merged: false,
              draft: pullRequest.draft,
              repository: metadata.repository ?? pullRequestRepo,
            } satisfies PullRequestLinkMetadata,
          },
          database,
        );
      } else {
        if (target.ownRepository && links.length > 0) return;
        await createExternalLink(
          {
            taskId: task.id,
            integrationId: integration.id,
            resourceType: "pull_request",
            externalId: pullRequest.number.toString(),
            url: pullRequest.html_url,
            title: pullRequest.title,
            metadata: {
              state: pullRequest.state,
              draft: pullRequest.draft,
              merged: pullRequest.merged,
              branch: pullRequest.head.ref,
              author: pullRequest.user?.login,
              repository: pullRequestRepo,
            } satisfies PullRequestLinkMetadata,
          },
          database,
        );
      }

      afterCommit(() =>
        publishEvent("task.updated", {
          projectId: integration.projectId,
          taskId: task.id,
        }),
      );

      const targetStatus = await resolveTargetStatus(
        integration.projectId,
        "pr_opened",
        config.statusTransitions?.onPROpen || "in-review",
        database,
      );

      if (currentTask.status === targetStatus) return;
      // A new pull request reopens completed work; a reopened one leaves it done.
      if (existing && (await isTaskInFinalState(currentTask, database))) return;

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
