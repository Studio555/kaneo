import { findExternalLinksByTask } from "../../github/services/link-manager";
import { toCraftLabelName } from "../../system-labels";
import type { PluginContext, TaskCraftChangedEvent } from "../../types";
import type { GiteaConfig } from "../config";
import { addLabelsToIssueGitea, removeLabelGitea } from "../utils/labels";

export async function handleTaskCraftChanged(
  event: TaskCraftChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = context.config as GiteaConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  try {
    const links = await findExternalLinksByTask(event.taskId);
    const issueLink = links.find(
      (link) =>
        link.integrationId === context.integrationId &&
        link.resourceType === "issue",
    );

    if (!issueLink) {
      return;
    }

    const issueNumber = Number.parseInt(issueLink.externalId, 10);

    if (event.oldCraftName) {
      await removeLabelGitea(
        config,
        issueNumber,
        toCraftLabelName(event.oldCraftName),
      );
    }

    if (event.newCraftName) {
      const labelName = toCraftLabelName(event.newCraftName);
      await addLabelsToIssueGitea(
        config,
        issueNumber,
        [labelName],
        event.newCraftColor ? { [labelName]: event.newCraftColor } : undefined,
      );
    }
  } catch (error) {
    console.error("Failed to update Gitea issue craft:", error);
  }
}
