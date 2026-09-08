import type { PluginContext } from "../../types";
import type { GitHubConfig } from "../config";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../services/link-manager";
import { findTaskById } from "../services/task-service";
import {
  getGithubLoginForUser,
  refreshGithubLoginForUser,
  type UserResolvingOctokit,
} from "../services/user-link";
import { getGithubApp, getInstallationIdForRepo } from "./github-app";
import { parseLinkMetadata } from "./parse-link-metadata";

type AssigneeOctokit = UserResolvingOctokit & {
  rest: {
    issues: {
      update: (params: Record<string, unknown>) => Promise<unknown>;
      checkUserCanBeAssigned: (
        params: Record<string, unknown>,
      ) => Promise<unknown>;
    };
  };
};

/**
 * GitHub accepts an assignee who lacks repo access and then drops them from
 * the write without an error, so the sync would fail invisibly. Asking first
 * is what turns that into a log line.
 */
async function canBeAssigned(
  octokit: AssigneeOctokit,
  owner: string,
  repo: string,
  assignee: string,
): Promise<boolean> {
  try {
    await octokit.rest.issues.checkUserCanBeAssigned({ owner, repo, assignee });
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes the linked issue name the same person the task does: `assigneeId`'s
 * GitHub handle as the issue's only assignee, or an empty list when the task
 * was unassigned.
 *
 * Replacing the list rather than adding to it is deliberate — the point of the
 * feature is that both sides agree. The write is recorded in the link metadata
 * so the inbound webhook can tell our own update from a person's.
 *
 * Resolving the handle needs a GitHub client, so it happens here rather than in
 * the handlers: one pass builds the client, resolves the link and writes.
 */
export async function syncIssueAssignee(
  taskId: string,
  assigneeId: string | null,
  context: PluginContext,
  source: string,
): Promise<void> {
  const githubApp = getGithubApp();
  if (!githubApp) {
    return;
  }

  const config = context.config as GitHubConfig;
  const { repositoryOwner, repositoryName } = config;

  try {
    const links = await findExternalLinksByTask(taskId);
    const issueLink = links.find(
      (link) =>
        link.integrationId === context.integrationId &&
        link.resourceType === "issue",
    );

    if (!issueLink) {
      return;
    }

    let installationId = config.installationId;
    if (!installationId) {
      installationId = await getInstallationIdForRepo(
        repositoryOwner,
        repositoryName,
      );
    }

    const octokit = (await githubApp.getInstallationOctokit(
      installationId,
    )) as unknown as AssigneeOctokit;

    // Two assignment events can reach GitHub out of order, and the loser would
    // write last and leave the issue disagreeing with the board. The task row
    // is the authority on who is assigned now, so an event it has moved past
    // is dropped rather than applied.
    const task = await findTaskById(taskId);
    if (!task || task.userId !== assigneeId) {
      return;
    }

    let login: string | null = null;
    if (assigneeId) {
      login = await getGithubLoginForUser(assigneeId, octokit);

      if (!login) {
        console.warn(
          "Skipping GitHub assignee sync: no linked GitHub account",
          {
            taskId,
            assigneeId,
          },
        );
        return;
      }

      if (
        !(await canBeAssigned(octokit, repositoryOwner, repositoryName, login))
      ) {
        // A GitHub rename leaves the cached handle stale, and this check is
        // where that first surfaces. Re-resolve from the stored numeric id
        // once before concluding the user simply cannot be assigned.
        const refreshed = await refreshGithubLoginForUser(assigneeId, octokit);

        if (
          !refreshed ||
          refreshed === login ||
          !(await canBeAssigned(
            octokit,
            repositoryOwner,
            repositoryName,
            refreshed,
          ))
        ) {
          console.warn(
            "Skipping GitHub assignee sync: user cannot be assigned",
            {
              taskId,
              login,
              repository: `${repositoryOwner}/${repositoryName}`,
            },
          );
          return;
        }

        login = refreshed;
      }
    }

    const existingMetadata = parseLinkMetadata(issueLink.metadata, {
      externalLinkId: issueLink.id,
      source,
    });

    await octokit.rest.issues.update({
      owner: repositoryOwner,
      repo: repositoryName,
      issue_number: Number.parseInt(issueLink.externalId, 10),
      assignees: login ? [login] : [],
    });

    await updateExternalLink(issueLink.id, {
      metadata: {
        ...existingMetadata,
        assigneeLogin: login,
        lastOutboundAssigneeSyncAt: Date.now(),
      },
    });
  } catch (error) {
    console.error("Failed to update GitHub issue assignee:", error);
  }
}
