import type { PluginContext, TaskRelationChangedEvent } from "../../types";
import {
  addSubIssueOnGitHub,
  GITHUB_ORIGIN,
  removeSubIssueOnGitHub,
} from "../services/issue-hierarchy";
import { getGithubApp } from "../utils/github-app";

function isSubtaskFromKaneo(event: TaskRelationChangedEvent) {
  // A relation mirrored from GitHub is already on GitHub.
  return event.relationType === "subtask" && event.origin !== GITHUB_ORIGIN;
}

export async function handleTaskRelationCreated(
  event: TaskRelationChangedEvent,
  context: PluginContext,
): Promise<void> {
  if (!isSubtaskFromKaneo(event) || !getGithubApp()) return;

  try {
    await addSubIssueOnGitHub(event.sourceTaskId, event.targetTaskId, {
      replaceParent: true,
      onlyIntegrationId: context.integrationId,
    });
  } catch (error) {
    console.error("Failed to add GitHub sub-issue:", error);
  }
}

export async function handleTaskRelationDeleted(
  event: TaskRelationChangedEvent,
  context: PluginContext,
): Promise<void> {
  if (!isSubtaskFromKaneo(event) || !getGithubApp()) return;

  try {
    await removeSubIssueOnGitHub(event.sourceTaskId, event.targetTaskId, {
      onlyIntegrationId: context.integrationId,
    });
  } catch (error) {
    console.error("Failed to remove GitHub sub-issue:", error);
  }
}
