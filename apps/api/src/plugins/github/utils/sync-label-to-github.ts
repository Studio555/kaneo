import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { eq } from "drizzle-orm";
import db from "../../../database";
import { externalLinkTable } from "../../../database/schema";
import { toHexColor } from "../../label-color";
import { type GitHubConfig, hasVerifiedGitHubBinding } from "../config";
import { getVerifiedInstallationOctokit } from "./github-app";

async function getGitHubContext(taskId: string) {
  const externalLink = await db.query.externalLinkTable.findFirst({
    where: eq(externalLinkTable.taskId, taskId),
    with: {
      integration: true,
    },
  });

  if (externalLink?.resourceType !== "issue") {
    return null;
  }

  const integration = externalLink.integration;
  if (integration?.type !== "github" || !integration.isActive) {
    return null;
  }

  if (!(await canSyncTask(taskId, integration.id))) return null;

  let config: GitHubConfig;
  try {
    config = JSON.parse(integration.config);
  } catch {
    return null;
  }

  if (!hasVerifiedGitHubBinding(config) || !config.installationId) {
    return null;
  }

  let octokit: Awaited<ReturnType<typeof getVerifiedInstallationOctokit>>;
  try {
    octokit = await getVerifiedInstallationOctokit(config);
  } catch {
    return null;
  }

  return {
    externalLink,
    expectedConfig: integration.config,
    octokit,
    owner: config.repositoryOwner,
    repo: config.repositoryName,
    issueNumber: Number.parseInt(externalLink.externalId, 10),
  };
}

export async function syncLabelToGitHub(
  taskId: string,
  labelName: string,
  labelColor: string,
) {
  const ctx = await getGitHubContext(taskId);
  if (!ctx) return;

  const { octokit, owner, repo, issueNumber } = ctx;
  const color = toHexColor(labelColor);

  try {
    await octokit.rest.issues.getLabel({
      owner,
      repo,
      name: labelName,
    });
  } catch {
    try {
      const created = await dispatchIssueWrite(
        ctx.externalLink,
        ctx.expectedConfig,
        () =>
          octokit.rest.issues.createLabel({
            owner,
            repo,
            name: labelName,
            color,
          }),
      );
      if (!created) return;
    } catch (createError) {
      console.error(
        `Failed to create label "${labelName}" in GitHub:`,
        createError,
      );
      return;
    }
  }

  try {
    await dispatchIssueWrite(ctx.externalLink, ctx.expectedConfig, () =>
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [labelName],
      }),
    );
  } catch (error) {
    console.error(`Failed to add label "${labelName}" to GitHub issue:`, error);
  }
}

export async function removeLabelFromGitHub(taskId: string, labelName: string) {
  const ctx = await getGitHubContext(taskId);
  if (!ctx) return;

  const { octokit, owner, repo, issueNumber } = ctx;

  try {
    await dispatchIssueWrite(ctx.externalLink, ctx.expectedConfig, () =>
      octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      }),
    );
  } catch (error) {
    console.error(
      `Failed to remove label "${labelName}" from GitHub issue:`,
      error,
    );
  }
}
