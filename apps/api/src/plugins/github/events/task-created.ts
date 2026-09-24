import { isBacklogStatus } from "../../backlog-status";
import type { PluginContext, TaskCreatedEvent } from "../../types";
import type { GitHubConfig } from "../config";
import { ensureIssueForTask } from "../services/issue-creator";
import { getGithubApp, getInstallationIdForRepo } from "../utils/github-app";

export async function handleTaskCreated(
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  if (await isBacklogStatus(event.projectId, event.status)) {
    return;
  }

  const githubApp = getGithubApp();
  if (!githubApp) {
    return;
  }

  const config = context.config as GitHubConfig;

  try {
    let installationId = config.installationId;
    if (!installationId) {
      installationId = await getInstallationIdForRepo(
        config.repositoryOwner,
        config.repositoryName,
      );
    }

    const octokit = await githubApp.getInstallationOctokit(installationId);

    await ensureIssueForTask(
      octokit,
      {
        taskId: event.taskId,
        projectId: event.projectId,
        number: event.number,
        title: event.title,
        description: event.description,
        priority: event.priority,
        status: event.status,
        craftName: event.craftName,
        craftColor: event.craftColor,
        // On task.created the event's userId is the assignee, not the actor.
        assigneeId: event.userId || null,
      },
      context,
    );
  } catch (error) {
    console.error("Failed to create GitHub issue:", error);
  }
}
