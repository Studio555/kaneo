import { publishEvent } from "../../../events";
import type { GitHubConfig } from "../config";
import {
  createExternalLink,
  findExternalLink,
  findPullRequestLinks,
  type PullRequestLinkMetadata,
  updateExternalLink,
} from "../services/link-manager";
import {
  findAllActiveGithubIntegrations,
  findTaskById,
  findTaskByNumber,
  isTaskInFinalState,
  type TaskRow,
  updateTaskStatus,
} from "../services/task-service";
import { extractTaskNumber } from "../utils/branch-matcher";
import { parseIntegrationConfig } from "../utils/integration-config";
import { extractIssueReferencesFromPullRequest } from "../utils/issue-reference";
import { parseLinkMetadata } from "../utils/parse-link-metadata";
import { repositoryFullName, sameRepository } from "../utils/repository";
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
  repository: {
    owner: { login: string };
    name: string;
    full_name?: string;
  };
  installation?: { id: number };
};

type Integration = Awaited<
  ReturnType<typeof findAllActiveGithubIntegrations>
>[number];

type LinkContext = {
  integration: Integration;
  config: GitHubConfig;
  integrationRepo: string;
  pullRequest: PROpenedPayload["pull_request"];
  pullRequestRepo: string;
};

/**
 * Handles `pull_request.opened`, `reopened`, and `edited`.
 *
 * A pull request in the integration's own repository names its task by task
 * number, as before. A pull request in any other repository names it through
 * the task's GitHub issue instead (`owner/repo#12` or the issue URL in the
 * branch, title, or body), which is what the developer already writes for
 * GitHub's own cross-references.
 */
export async function handlePullRequestOpened(payload: PROpenedPayload) {
  const { pull_request, repository } = payload;
  const pullRequestRepo =
    repository.full_name ??
    repositoryFullName(repository.owner.login, repository.name);

  const integrations = await findAllActiveGithubIntegrations();
  let linkedInOwnRepo = false;

  for (const integration of integrations) {
    if (!integration.project) {
      continue;
    }

    const config = parseIntegrationConfig(integration);
    if (!config) {
      continue;
    }

    const integrationRepo = repositoryFullName(
      config.repositoryOwner,
      config.repositoryName,
    );
    const context: LinkContext = {
      integration,
      config,
      integrationRepo,
      pullRequest: pull_request,
      pullRequestRepo,
    };

    if (sameRepository(pullRequestRepo, integrationRepo)) {
      // Several projects may share one repository; the first that claims the
      // task number wins, as before.
      if (linkedInOwnRepo) {
        continue;
      }

      const taskNumber = extractTaskNumber(
        pull_request.head.ref,
        pull_request.title,
        pull_request.body ?? undefined,
        config,
        integration.project.slug,
      );
      if (taskNumber === null) {
        continue;
      }

      const task = await findTaskByNumber(integration.projectId, taskNumber);
      if (!task) {
        continue;
      }

      await linkPullRequestToTask(context, task);
      linkedInOwnRepo = true;
      continue;
    }

    // Any repository the App is installed on may reference the issue repo, but
    // only from within the same installation as the integration.
    if (
      config.installationId &&
      payload.installation &&
      payload.installation.id !== config.installationId
    ) {
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
      const issueLink = await findExternalLink(
        integration.id,
        "issue",
        issueNumber.toString(),
      );
      if (!issueLink) {
        continue;
      }

      const task = await findTaskById(issueLink.taskId);
      if (!task) {
        continue;
      }

      await linkPullRequestToTask(context, task);
    }
  }
}

async function linkPullRequestToTask(context: LinkContext, task: TaskRow) {
  const { integration, config, integrationRepo, pullRequest, pullRequestRepo } =
    context;

  const links = await findPullRequestLinks(
    integration.id,
    pullRequest.number,
    pullRequestRepo,
    integrationRepo,
  );
  const existing = links.find((link) => link.taskId === task.id);

  if (existing) {
    const metadata = parseLinkMetadata<PullRequestLinkMetadata>(
      existing.metadata,
      { externalLinkId: existing.id, source: "pull_request_opened" },
    );
    if (pullRequest.state !== "open" || metadata.state === "open") {
      return;
    }

    await updateExternalLink(existing.id, {
      title: pullRequest.title,
      metadata: {
        ...metadata,
        state: "open",
        merged: false,
        draft: pullRequest.draft,
        repository: metadata.repository ?? pullRequestRepo,
      },
    });
  } else {
    await createExternalLink({
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
    });
  }

  const statusChanged = await applyOpenTransition(integration, config, task);
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

async function applyOpenTransition(
  integration: Integration,
  config: GitHubConfig,
  task: TaskRow,
): Promise<boolean> {
  const targetStatus = await resolveTargetStatus(
    integration.projectId,
    "pr_opened",
    config.statusTransitions?.onPROpen || "in-review",
  );

  if (task.status === targetStatus || (await isTaskInFinalState(task))) {
    return false;
  }

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
