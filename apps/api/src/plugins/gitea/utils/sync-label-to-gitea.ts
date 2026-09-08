import { eq } from "drizzle-orm";
import db from "../../../database";
import { externalLinkTable } from "../../../database/schema";
import { toHexColor } from "../../label-color";
import type { GiteaConfig } from "../config";
import { createGiteaClient } from "./gitea-api";

async function getGiteaIssueContext(taskId: string) {
  const externalLinks = await db.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.taskId, taskId),
    with: {
      integration: true,
    },
  });

  const externalLink = externalLinks.find(
    (link) =>
      link.resourceType === "issue" && link.integration?.type === "gitea",
  );

  if (!externalLink) {
    return null;
  }

  const integration = externalLink.integration;
  if (!integration) {
    return null;
  }

  let config: GiteaConfig;
  try {
    config = JSON.parse(integration.config) as GiteaConfig;
  } catch {
    return null;
  }

  if (!config.accessToken || !config.baseUrl) {
    return null;
  }

  const client = createGiteaClient(config);
  const issueNumber = Number.parseInt(externalLink.externalId, 10);
  if (Number.isNaN(issueNumber)) {
    console.warn("Invalid Gitea issue externalId for label sync", {
      externalLinkId: externalLink.id,
      externalId: externalLink.externalId,
      taskId,
    });
    return null;
  }

  return {
    client,
    config,
    issueNumber,
  };
}

export async function syncLabelToGitea(
  taskId: string,
  labelName: string,
  labelColor: string,
) {
  const ctx = await getGiteaIssueContext(taskId);
  if (!ctx) return;

  const { client, config, issueNumber } = ctx;
  const color = toHexColor(labelColor);

  const labels = await client.listLabels(
    config.repositoryOwner,
    config.repositoryName,
  );
  let label = labels.find((l) => l.name === labelName);

  if (!label) {
    try {
      label = await client.createLabel(
        config.repositoryOwner,
        config.repositoryName,
        labelName,
        color,
      );
    } catch (error) {
      console.error(`Failed to create label "${labelName}" in Gitea:`, error);
      return;
    }
  }

  try {
    const issue = await client.getIssue(
      config.repositoryOwner,
      config.repositoryName,
      issueNumber,
    );
    const existingIds = (issue.labels ?? []).map((l) => l.id);
    if (existingIds.includes(label.id)) {
      return;
    }
    await client.addLabelsToIssue(
      config.repositoryOwner,
      config.repositoryName,
      issueNumber,
      [label.id],
    );
  } catch (error) {
    console.error(`Failed to add label "${labelName}" to Gitea issue:`, error);
  }
}

export async function removeLabelFromGitea(taskId: string, labelName: string) {
  const ctx = await getGiteaIssueContext(taskId);
  if (!ctx) return;

  const { client, config, issueNumber } = ctx;

  const labels = await client.listLabels(
    config.repositoryOwner,
    config.repositoryName,
  );
  const label = labels.find((l) => l.name === labelName);
  if (!label) return;

  try {
    await client.removeLabelFromIssue(
      config.repositoryOwner,
      config.repositoryName,
      issueNumber,
      label.id,
    );
  } catch (error) {
    console.error(
      `Failed to remove label "${labelName}" from Gitea issue:`,
      error,
    );
  }
}
