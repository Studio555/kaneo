import { and, eq, inArray, or } from "drizzle-orm";
import db from "../../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../../database/schema";
import { publishEvent } from "../../../events";
import { withKeyedLock } from "../../../utils/keyed-lock";
import type { GitHubConfig } from "../config";
import { getVerifiedInstallationOctokit } from "../utils/github-app";
import { findExternalLink, findExternalLinksByTask } from "./link-manager";
import { findAllIntegrationsByRepoName } from "./task-service";

/**
 * Keeps Kaneo subtasks and GitHub sub-issues the same tree.
 *
 * A Kaneo `subtask` relation (source = parent, target = child) and a GitHub
 * sub-issue are one fact recorded in two places, so each side is written from
 * the other. Every write is idempotent: the webhook for a sub-issue Kaneo just
 * added finds the relation already there and does nothing, and a relation
 * Kaneo mirrors from GitHub is published with `origin: "github"` so the
 * outbound handler does not send it straight back.
 */

export const GITHUB_ORIGIN = "github";

export type IssueRef = { owner: string; repo: string; number: number };

type LinkedTask = { taskId: string; projectId: string; workspaceId: string };

type LinkedIssue = IssueRef & {
  integrationId: string;
  config: GitHubConfig;
};

/** `owner/repo` from an issue's `repository_url` (`…/repos/owner/repo`). */
export function repoFromRepositoryUrl(
  url: string | undefined,
): { owner: string; repo: string } | null {
  const match = url?.match(/\/repos\/([^/]+)\/([^/]+)\/?$/);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

/** Every Kaneo task linked to a GitHub issue, across all integrations on its repository. */
export async function findTasksForIssue(ref: IssueRef): Promise<LinkedTask[]> {
  const integrations = await findAllIntegrationsByRepoName(ref.owner, ref.repo);
  const taskIds: string[] = [];

  for (const integration of integrations) {
    const link = await findExternalLink(
      integration.id,
      "issue",
      ref.number.toString(),
    );
    if (link && !taskIds.includes(link.taskId)) {
      taskIds.push(link.taskId);
    }
  }

  if (taskIds.length === 0) return [];

  return db
    .select({
      taskId: taskTable.id,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(inArray(taskTable.id, taskIds));
}

/** The GitHub issue a task is linked to, or null when it has none yet. */
export async function findLinkedIssue(
  taskId: string,
): Promise<LinkedIssue | null> {
  const links = await findExternalLinksByTask(taskId);

  for (const link of links) {
    if (
      link.resourceType !== "issue" ||
      !link.integrationId ||
      link.integration?.type !== "github" ||
      !link.integration.isActive
    ) {
      continue;
    }

    const config = JSON.parse(link.integration.config) as GitHubConfig;
    return {
      owner: config.repositoryOwner,
      repo: config.repositoryName,
      number: Number.parseInt(link.externalId, 10),
      integrationId: link.integrationId,
      config,
    };
  }

  return null;
}

function pairsInSameWorkspace(parents: LinkedTask[], children: LinkedTask[]) {
  const pairs: Array<{ parent: LinkedTask; child: LinkedTask }> = [];
  for (const parent of parents) {
    for (const child of children) {
      if (
        parent.taskId !== child.taskId &&
        parent.workspaceId === child.workspaceId
      ) {
        pairs.push({ parent, child });
      }
    }
  }
  return pairs;
}

function relationLockKey(parentTaskId: string, childTaskId: string) {
  // Sorted, so the add for a pair and its reverse cannot both slip through.
  return `subtask:${[parentTaskId, childTaskId].sort().join(":")}`;
}

/** Records `child` as a subtask of `parent` in Kaneo. Returns false when it already was. */
async function addSubtaskInKaneo(
  parent: LinkedTask,
  child: LinkedTask,
): Promise<boolean> {
  return withKeyedLock(
    relationLockKey(parent.taskId, child.taskId),
    async () => {
      // Either direction counts: the reverse would make a cycle.
      const [existing] = await db
        .select({ id: taskRelationTable.id })
        .from(taskRelationTable)
        .where(
          and(
            eq(taskRelationTable.relationType, "subtask"),
            or(
              and(
                eq(taskRelationTable.sourceTaskId, parent.taskId),
                eq(taskRelationTable.targetTaskId, child.taskId),
              ),
              and(
                eq(taskRelationTable.sourceTaskId, child.taskId),
                eq(taskRelationTable.targetTaskId, parent.taskId),
              ),
            ),
          ),
        )
        .limit(1);

      if (existing) return false;

      const [relation] = await db
        .insert(taskRelationTable)
        .values({
          sourceTaskId: parent.taskId,
          targetTaskId: child.taskId,
          relationType: "subtask",
        })
        .returning();

      if (!relation) return false;

      await publishEvent("task-relation.created", {
        ...relation,
        taskId: parent.taskId,
        projectId: parent.projectId,
        userId: null,
        origin: GITHUB_ORIGIN,
      });
      return true;
    },
  );
}

/** Removes the `parent` → `child` subtask relation from Kaneo. Returns false when there was none. */
async function removeSubtaskInKaneo(
  parent: LinkedTask,
  child: LinkedTask,
): Promise<boolean> {
  return withKeyedLock(
    relationLockKey(parent.taskId, child.taskId),
    async () => {
      const [relation] = await db
        .delete(taskRelationTable)
        .where(
          and(
            eq(taskRelationTable.relationType, "subtask"),
            eq(taskRelationTable.sourceTaskId, parent.taskId),
            eq(taskRelationTable.targetTaskId, child.taskId),
          ),
        )
        .returning();

      if (!relation) return false;

      await publishEvent("task-relation.deleted", {
        ...relation,
        taskId: parent.taskId,
        projectId: parent.projectId,
        userId: null,
        origin: GITHUB_ORIGIN,
      });
      return true;
    },
  );
}

/** Mirrors a GitHub sub-issue change onto every pair of tasks linked to the two issues. */
export async function applySubIssueChangeToKaneo(
  parentIssue: IssueRef,
  childIssue: IssueRef,
  change: "added" | "removed",
): Promise<number> {
  const [parents, children] = await Promise.all([
    findTasksForIssue(parentIssue),
    findTasksForIssue(childIssue),
  ]);

  let applied = 0;
  for (const { parent, child } of pairsInSameWorkspace(parents, children)) {
    const changed =
      change === "added"
        ? await addSubtaskInKaneo(parent, child)
        : await removeSubtaskInKaneo(parent, child);
    if (changed) applied++;
  }
  return applied;
}

function httpStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

/**
 * Makes the child's issue a sub-issue of the parent's issue on GitHub. Does
 * nothing unless both tasks already have issues; the one opened later picks
 * the relation up through {@link reconcileIssueHierarchy}.
 *
 * `replaceParent` moves an issue that already has a different parent. GitHub
 * allows one parent per issue, so the Kaneo action that asked for a new parent
 * wins, and the removal webhook for the old parent then drops that relation
 * from Kaneo too. Reconciling passes false so it never overrides GitHub.
 */
export async function addSubIssueOnGitHub(
  parentTaskId: string,
  childTaskId: string,
  options: { replaceParent: boolean; onlyIntegrationId?: string },
): Promise<boolean> {
  const [parent, child] = await Promise.all([
    findLinkedIssue(parentTaskId),
    findLinkedIssue(childTaskId),
  ]);
  if (!parent || !child) return false;
  if (
    options.onlyIntegrationId &&
    parent.integrationId !== options.onlyIntegrationId
  ) {
    return false;
  }

  const childOctokit = await getVerifiedInstallationOctokit(child.config);
  const { data: childIssue } = await childOctokit.rest.issues.get({
    owner: child.owner,
    repo: child.repo,
    issue_number: child.number,
  });

  const parentOctokit = await getVerifiedInstallationOctokit(parent.config);
  try {
    await parentOctokit.rest.issues.addSubIssue({
      owner: parent.owner,
      repo: parent.repo,
      issue_number: parent.number,
      sub_issue_id: childIssue.id,
      replace_parent: options.replaceParent,
    });
    return true;
  } catch (error) {
    // 422 covers "already a sub-issue of this issue" and, without
    // replace_parent, "already has a parent" — both leave GitHub as it is.
    if (httpStatus(error) === 422) {
      console.log(
        `GitHub kept ${child.owner}/${child.repo}#${child.number} out of ${parent.owner}/${parent.repo}#${parent.number}:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    }
    throw error;
  }
}

/** Removes the child's issue from the parent's sub-issues on GitHub. */
export async function removeSubIssueOnGitHub(
  parentTaskId: string,
  childTaskId: string,
  options: { onlyIntegrationId?: string } = {},
): Promise<boolean> {
  const [parent, child] = await Promise.all([
    findLinkedIssue(parentTaskId),
    findLinkedIssue(childTaskId),
  ]);
  if (!parent || !child) return false;
  if (
    options.onlyIntegrationId &&
    parent.integrationId !== options.onlyIntegrationId
  ) {
    return false;
  }

  const childOctokit = await getVerifiedInstallationOctokit(child.config);
  const { data: childIssue } = await childOctokit.rest.issues.get({
    owner: child.owner,
    repo: child.repo,
    issue_number: child.number,
  });

  const parentOctokit = await getVerifiedInstallationOctokit(parent.config);
  try {
    await parentOctokit.rest.issues.removeSubIssue({
      owner: parent.owner,
      repo: parent.repo,
      issue_number: parent.number,
      sub_issue_id: childIssue.id,
    });
    return true;
  } catch (error) {
    // Already gone, typically because the removal started on GitHub.
    const status = httpStatus(error);
    if (status === 404 || status === 422) return false;
    throw error;
  }
}

/**
 * Brings one task's place in the tree into agreement on both sides, for when
 * its issue link is new: an issue opened on GitHub may already sit under a
 * parent or have sub-issues, and a task that waited in the backlog may already
 * have Kaneo subtasks or a Kaneo parent that GitHub has never seen.
 *
 * Only ever adds. Where the two sides disagree about a child's parent, GitHub
 * keeps its one parent and Kaneo ends up recording both.
 */
export async function reconcileIssueHierarchy(taskId: string): Promise<void> {
  const issue = await findLinkedIssue(taskId);
  if (!issue) return;

  const octokit = await getVerifiedInstallationOctokit(issue.config);

  try {
    const { data: parentIssue } = await octokit.rest.issues.getParent({
      owner: issue.owner,
      repo: issue.repo,
      issue_number: issue.number,
    });
    const parentRepo = repoFromRepositoryUrl(parentIssue.repository_url);
    if (parentRepo) {
      await applySubIssueChangeToKaneo(
        { ...parentRepo, number: parentIssue.number },
        issue,
        "added",
      );
    }
  } catch (error) {
    // 404 is "this issue has no parent".
    if (httpStatus(error) !== 404) throw error;
  }

  const subIssues = await octokit.paginate(octokit.rest.issues.listSubIssues, {
    owner: issue.owner,
    repo: issue.repo,
    issue_number: issue.number,
    per_page: 100,
  });
  for (const subIssue of subIssues) {
    const subRepo = repoFromRepositoryUrl(subIssue.repository_url);
    if (!subRepo) continue;
    await applySubIssueChangeToKaneo(
      issue,
      { ...subRepo, number: subIssue.number },
      "added",
    );
  }

  const relations = await db
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
    })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.relationType, "subtask"),
        or(
          eq(taskRelationTable.sourceTaskId, taskId),
          eq(taskRelationTable.targetTaskId, taskId),
        ),
      ),
    );

  for (const relation of relations) {
    await addSubIssueOnGitHub(relation.sourceTaskId, relation.targetTaskId, {
      replaceParent: false,
    });
  }
}

/** {@link reconcileIssueHierarchy}, logging instead of throwing, for callers whose own work already succeeded. */
export async function reconcileIssueHierarchySafely(
  taskId: string,
): Promise<void> {
  try {
    await reconcileIssueHierarchy(taskId);
  } catch (error) {
    console.error(
      `Failed to reconcile GitHub sub-issues for task ${taskId}:`,
      error,
    );
  }
}
