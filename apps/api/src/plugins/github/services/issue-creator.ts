import { eq } from "drizzle-orm";
import type { Octokit } from "octokit";
import db from "../../../database";
import { projectTable } from "../../../database/schema";
import { withKeyedLock } from "../../../utils/keyed-lock";
import { toCraftLabelName } from "../../system-labels";
import type { PluginContext } from "../../types";
import type { GitHubConfig } from "../config";
import {
  formatIssueBody,
  formatIssueTitle,
  getLabelsForIssue,
} from "../utils/format";
import { addLabelsToIssue } from "../utils/labels";
import { parseLinkMetadata } from "../utils/parse-link-metadata";
import { syncIssueAssignee } from "../utils/sync-issue-assignee";
import { reconcileIssueHierarchySafely } from "./issue-hierarchy";
import {
  createExternalLink,
  findExternalLinkByTaskAndType,
} from "./link-manager";

/** The task fields an issue is built from, whatever event carries them. */
export type IssueSource = {
  taskId: string;
  projectId: string;
  /** Null only for rows predating task numbering; the link comment needs it. */
  number: number | null;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  craftName?: string | null;
  craftColor?: string | null;
  /** Who the task is assigned to, so a brand new issue names them too. */
  assigneeId?: string | null;
};

export type ResolvedIssue = {
  externalLinkId: string;
  issueNumber: number;
  metadata: Record<string, unknown>;
  /** False when another handler had already opened the issue. */
  created: boolean;
};

/**
 * Opens the GitHub issue for a task, or adopts the one another handler opened
 * first. `task.created` and `task.status_changed` are dispatched without being
 * awaited, so a task created in a column and moved moments later has both
 * handlers racing to open the same issue; the lock lets exactly one win.
 */
export async function ensureIssueForTask(
  octokit: Octokit,
  source: IssueSource,
  context: PluginContext,
): Promise<ResolvedIssue | null> {
  return withKeyedLock(
    `${context.integrationId}:${source.taskId}`,
    async () => {
      const existingLink = await findExternalLinkByTaskAndType(
        source.taskId,
        context.integrationId,
        "issue",
      );

      if (existingLink) {
        return {
          externalLinkId: existingLink.id,
          issueNumber: Number.parseInt(existingLink.externalId, 10),
          metadata: parseLinkMetadata(existingLink.metadata, {
            externalLinkId: existingLink.id,
            source: "ensure_issue_for_task",
          }),
          created: false,
        };
      }

      return createIssue(octokit, source, context);
    },
  );
}

async function createIssue(
  octokit: Octokit,
  source: IssueSource,
  context: PluginContext,
): Promise<ResolvedIssue> {
  const config = context.config as GitHubConfig;
  const { repositoryOwner, repositoryName } = config;

  const createdIssue = await octokit.rest.issues.create({
    owner: repositoryOwner,
    repo: repositoryName,
    title: formatIssueTitle(source.title),
    body: formatIssueBody(source.description, source.taskId),
  });

  const labels = getLabelsForIssue(
    source.priority,
    source.status,
    source.craftName,
  );
  await addLabelsToIssue(
    octokit,
    repositoryOwner,
    repositoryName,
    createdIssue.data.number,
    labels,
    source.craftName && source.craftColor
      ? { [toCraftLabelName(source.craftName)]: source.craftColor }
      : undefined,
  );

  const metadata = {
    state: createdIssue.data.state,
    createdFrom: "kaneo",
  };

  const link = await createExternalLink({
    taskId: source.taskId,
    integrationId: context.integrationId,
    resourceType: "issue",
    externalId: createdIssue.data.number.toString(),
    url: createdIssue.data.html_url,
    title: createdIssue.data.title,
    metadata,
  });

  if (config.commentTaskLinkOnGitHubIssue !== false && source.number !== null) {
    const project = await db.query.projectTable.findFirst({
      where: eq(projectTable.id, source.projectId),
    });

    if (project) {
      const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
      const taskUrl = `${clientUrl}/dashboard/workspace/${project.workspaceId}/project/${source.projectId}/task/${source.taskId}`;
      const taskIdentifier = `${project.slug.toUpperCase()}-${source.number}`;

      await octokit.rest.issues.createComment({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: createdIssue.data.number,
        body: `[${taskIdentifier}](${taskUrl})`,
      });
    }
  }

  // A task can be assigned before its issue exists, either created with an
  // assignee or assigned while it sat in the backlog. Neither emits an
  // assignee event the issue could act on, so the new issue picks the
  // assignee up here. The link it needs was written just above.
  if (source.assigneeId) {
    await syncIssueAssignee(
      source.taskId,
      source.assigneeId,
      context,
      "issue_created",
    );
  }

  // Subtask relations made while the task sat in the backlog had no issue to
  // attach to; this is the first moment they can reach GitHub.
  await reconcileIssueHierarchySafely(source.taskId);

  return {
    externalLinkId: link.id,
    issueNumber: createdIssue.data.number,
    metadata,
    created: true,
  };
}
