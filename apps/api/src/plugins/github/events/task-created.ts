import {
  initializeTaskIssue,
  isIssueInitializationPending,
} from "../../sync/initialize-task-issue";
import { canSyncTask } from "../../sync/eligibility";
import { withTaskSyncCreation } from "../../sync/create-task-issue";
import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import { isBacklogStatus } from "../../backlog-status";
import { toCraftLabelName } from "../../system-labels";
import { eq } from "drizzle-orm";
import db from "../../../database";
import { projectTable } from "../../../database/schema";
import type { PluginContext, TaskCreatedEvent } from "../../types";
import { type GitHubConfig, hasVerifiedGitHubBinding } from "../config";
import {
  createExternalLink,
  updateExternalLink,
  findExternalLinkByTaskAndType,
} from "../services/link-manager";
import { formatIssueBody, formatIssueTitle } from "../utils/format";
import { reconcileIssueHierarchySafely } from "../services/issue-hierarchy";
import { taskLinkCommentExists } from "../services/task-link-comment-exists";
import { findTaskWithCraft } from "../services/task-service";
import {
  getGithubApp,
  getVerifiedInstallationOctokit,
} from "../utils/github-app";
import { addLabelsToIssue, removeLabel } from "../utils/labels";
import { syncIssueAssignee } from "../utils/sync-issue-assignee";

async function createTaskIssue(
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  const githubApp = getGithubApp();
  if (!githubApp) {
    return;
  }

  const config = context.config as GitHubConfig;
  if (!hasVerifiedGitHubBinding(config)) return;
  const { repositoryOwner, repositoryName } = config;

  const existingLink = await findExternalLinkByTaskAndType(
    event.taskId,
    context.integrationId,
    "issue",
  );

  if (existingLink && !isIssueInitializationPending(existingLink)) return;
  // Backlog tasks are not committed work; leaving the backlog opens the issue.
  if (!existingLink && (await isBacklogStatus(event.projectId, event.status)))
    return;

  try {
    const octokit = await getVerifiedInstallationOctokit(config, true);

    if (
      !(await canSyncTask(
        event.taskId,
        context.integrationId,
        undefined,
        JSON.stringify(context.config),
      ))
    )
      return;

    let createdLink: { id: string; metadata?: string | null } | undefined =
      existingLink;
    let issueNumber = existingLink ? Number(existingLink.externalId) : 0;
    if (!existingLink) {
      const createdIssue = await octokit.rest.issues.create({
        owner: repositoryOwner,
        repo: repositoryName,
        title: formatIssueTitle(event.title),
        body: formatIssueBody(event.description, event.taskId),
      });

      createdLink = await createExternalLink({
        taskId: event.taskId,
        integrationId: context.integrationId,
        resourceType: "issue",
        externalId: createdIssue.data.number.toString(),
        url: createdIssue.data.html_url,
        title: createdIssue.data.title,
        metadata: {
          state: createdIssue.data.state,
          createdFrom: "kaneo",
          syncFieldLabels: [],
          syncInitializationPending: true,
          syncCreatedText: {
            title: event.title,
            description: event.description ?? "",
          },
        },
      });
      issueNumber = createdIssue.data.number;
    }
    if (!createdLink) return;

    if (
      !(await canSyncTask(
        event.taskId,
        context.integrationId,
        undefined,
        JSON.stringify(context.config),
      ))
    ) {
      await updateExternalLink(createdLink.id, {
        metadata: { syncFilterPaused: true },
      });
      return;
    }

    let comment: string | undefined;
    if (config.commentTaskLinkOnGitHubIssue !== false) {
      const project = await db.query.projectTable.findFirst({
        where: eq(projectTable.id, event.projectId),
      });
      if (project) {
        const clientUrl =
          process.env.KANEO_CLIENT_URL || "http://localhost:5173";
        const taskUrl = `${clientUrl}/dashboard/workspace/${project.workspaceId}/project/${event.projectId}/task/${event.taskId}`;
        comment = `[${project.slug.toUpperCase()}-${event.number}](${taskUrl})`;
      }
    }
    await initializeTaskIssue(event, context, createdLink, {
      text: async (field, value) =>
        (
          await octokit.rest.issues.update({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
            ...(field === "title"
              ? { title: formatIssueTitle(value) }
              : { body: formatIssueBody(value, event.taskId) }),
          })
        )?.data?.updated_at,
      state: async (value) =>
        (
          await octokit.rest.issues.update({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
            state: value === "closed" ? "closed" : "open",
          })
        )?.data?.updated_at,
      labels: () =>
        syncTaskFieldLabels(
          event.taskId,
          context,
          { id: createdLink.id, externalId: String(issueNumber) },
          "github",
          "initialization",
          async ({ add, remove }, write) => {
            for (const name of remove)
              await removeLabel(
                octokit,
                repositoryOwner,
                repositoryName,
                issueNumber,
                name,
                write,
              );
            await addLabelsToIssue(
              octokit,
              repositoryOwner,
              repositoryName,
              issueNumber,
              add,
              true,
              write,
            );
          },
        ),
      ...(comment
        ? {
            ...(existingLink
              ? {
                  commentExists: () =>
                    taskLinkCommentExists(
                      octokit,
                      repositoryOwner,
                      repositoryName,
                      issueNumber,
                      comment!,
                    ),
                }
              : {}),
            comment: () =>
              octokit.rest.issues.createComment({
                owner: repositoryOwner,
                repo: repositoryName,
                issue_number: issueNumber,
                body: comment!,
              }),
          }
        : {}),
    });

    const task = await findTaskWithCraft(event.taskId);
    if (task?.craft) {
      const craftLabel = toCraftLabelName(task.craft.name);
      await addLabelsToIssue(
        octokit,
        repositoryOwner,
        repositoryName,
        issueNumber,
        [craftLabel],
        false,
        undefined,
        { [craftLabel]: task.craft.color },
      );
    }
    // Assignees and subtask relations set while the task sat in the backlog
    // emitted nothing the issue could act on, so the new issue picks them up.
    if (task?.userId) {
      await syncIssueAssignee(task.id, task.userId, context, "issue_created");
    }
    await reconcileIssueHierarchySafely(event.taskId);
  } catch (error) {
    console.error("Failed to create GitHub issue:", error);
  }
}

export async function handleTaskCreated(
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  await withTaskSyncCreation(event, context, (current) =>
    createTaskIssue(current, context),
  );
}
