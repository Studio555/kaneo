import {
  addPendingCraftLabelOps,
  expectedCraftLabelOps,
  isOutboundCraftEcho,
  parseLinkMetadata,
  recordCraftSync,
} from "../../craft-sync-provenance";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../../github/services/link-manager";
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

    const metadata = parseLinkMetadata(issueLink.metadata);

    // The issue already carries this craft because the issue is where it came
    // from. Writing the label again would only produce another webhook.
    if (isOutboundCraftEcho(metadata, event.newCraftName ?? null)) {
      return;
    }

    // Written before the first label call, not after the last one: removing
    // the outgoing label makes Gitea deliver its webhook immediately, and that
    // can be handled while the add below is still in flight.
    const ops = expectedCraftLabelOps(
      event.oldCraftName ?? null,
      event.newCraftName ?? null,
    );

    if (ops.length > 0) {
      await updateExternalLink(issueLink.id, {
        metadata: addPendingCraftLabelOps(
          recordCraftSync(metadata, {
            source: "kaneo",
            value: event.newCraftName ?? null,
          }),
          ops,
        ),
      });
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
        false,
        undefined,
        event.newCraftColor ? { [labelName]: event.newCraftColor } : undefined,
      );
    }
  } catch (error) {
    console.error("Failed to update Gitea issue craft:", error);
  }
}
