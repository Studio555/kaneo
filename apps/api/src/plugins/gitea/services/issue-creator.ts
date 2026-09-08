import { withKeyedLock } from "../../../utils/keyed-lock";
import {
  createExternalLink,
  findExternalLinkByTaskAndType,
} from "../../github/services/link-manager";
import {
  formatIssueBody,
  formatIssueTitle,
  getLabelsForIssue,
} from "../../github/utils/format";
import { toCraftLabelName } from "../../system-labels";
import type { PluginContext } from "../../types";
import type { GiteaConfig } from "../config";
import { createGiteaClient } from "../utils/gitea-api";
import { addLabelsToIssueGitea } from "../utils/labels";

/** The task fields an issue is built from, whatever event carries them. */
export type IssueSource = {
  taskId: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  craftName?: string | null;
  craftColor?: string | null;
};

export type ResolvedIssue = {
  externalLinkId: string;
  issueNumber: number;
  metadata: Record<string, unknown>;
  /** False when another handler had already opened the issue. */
  created: boolean;
};

/**
 * Opens the Gitea issue for a task, or adopts the one another handler opened
 * first. `task.created` and `task.status_changed` are dispatched without being
 * awaited, so a task created in a column and moved moments later has both
 * handlers racing to open the same issue; the lock lets exactly one win.
 */
export async function ensureIssueForTask(
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
          metadata: existingLink.metadata
            ? JSON.parse(existingLink.metadata)
            : {},
          created: false,
        };
      }

      return createIssue(source, context);
    },
  );
}

async function createIssue(
  source: IssueSource,
  context: PluginContext,
): Promise<ResolvedIssue> {
  const config = context.config as GiteaConfig;
  const { repositoryOwner, repositoryName } = config;

  const client = createGiteaClient(config);
  const createdIssue = await client.createIssue(
    repositoryOwner,
    repositoryName,
    {
      title: formatIssueTitle(source.title),
      body: formatIssueBody(source.description, source.taskId),
    },
  );

  const metadata = {
    state: createdIssue.state,
    createdFrom: "kaneo",
    lastOutboundStateSyncAt: Date.now(),
  };

  const link = await createExternalLink({
    taskId: source.taskId,
    integrationId: context.integrationId,
    resourceType: "issue",
    externalId: createdIssue.number.toString(),
    url: createdIssue.html_url,
    title: createdIssue.title,
    metadata,
  });

  const labels = getLabelsForIssue(
    source.priority,
    source.status,
    source.craftName,
  );
  await addLabelsToIssueGitea(
    config,
    createdIssue.number,
    labels,
    source.craftName && source.craftColor
      ? { [toCraftLabelName(source.craftName)]: source.craftColor }
      : undefined,
  );

  return {
    externalLinkId: link.id,
    issueNumber: createdIssue.number,
    metadata,
    created: true,
  };
}
