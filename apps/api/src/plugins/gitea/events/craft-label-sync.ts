import { findExternalLinksByTask } from "../../github/services/link-manager";
import { toCraftLabelName } from "../../system-labels";
import type { CraftLabelSyncEvent, PluginContext } from "../../types";
import type { GiteaConfig } from "../config";
import { createGiteaClient } from "../utils/gitea-api";
import { ensureLabelsExistGitea, removeLabelGitea } from "../utils/labels";

/**
 * Replace (rename) or drop (delete) the `craft:` label across every linked
 * issue in this integration's project.
 *
 * The replacement label is resolved to its id once up front, then added to
 * each issue directly. Going through `addLabelsToIssueGitea` instead would
 * re-list every label in the repository on each task in the fan-out.
 */
export async function handleCraftLabelSync(
  event: CraftLabelSyncEvent,
  context: PluginContext,
): Promise<void> {
  const config = context.config as GiteaConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  const oldLabelName = toCraftLabelName(event.oldName);
  const newLabelName = event.newName ? toCraftLabelName(event.newName) : null;

  try {
    let newLabelId: number | undefined;

    if (newLabelName) {
      const labelIds = await ensureLabelsExistGitea(
        config,
        [newLabelName],
        event.color ? { [newLabelName]: event.color } : undefined,
      );
      newLabelId = labelIds.get(newLabelName);
    }

    const client = createGiteaClient(config);

    for (const taskId of event.taskIds) {
      try {
        const links = await findExternalLinksByTask(taskId);
        const issueLink = links.find(
          (link) =>
            link.integrationId === context.integrationId &&
            link.resourceType === "issue",
        );

        if (!issueLink) {
          continue;
        }

        const issueNumber = Number.parseInt(issueLink.externalId, 10);

        await removeLabelGitea(config, issueNumber, oldLabelName);

        if (newLabelId !== undefined) {
          await client.addLabelsToIssue(
            config.repositoryOwner,
            config.repositoryName,
            issueNumber,
            [newLabelId],
          );
        }
      } catch (error) {
        // One unreachable issue must not abandon the rest of the fan-out.
        console.error(
          `Failed to sync craft label for task ${taskId} in Gitea:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error("Failed to sync craft label to Gitea:", error);
  }
}
