import { and, eq } from "drizzle-orm";
import db from "../../database";
import { integrationTable, taskTable } from "../../database/schema";
import { withKeyedLock } from "../../utils/keyed-lock";
import type { GitHubConfig } from "../github/config";
import { ensureIssueForTask } from "../github/services/issue-creator";
import { createExternalLink } from "../github/services/link-manager";
import { getGithubLoginForUser } from "../github/services/user-link";
import {
  getGithubApp,
  getInstallationIdForRepo,
} from "../github/utils/github-app";
import { replyQuietly, type SlackClient, type SlackMessage } from "./client";
import {
  findOrFileTask,
  resolveKaneoUserId,
  resolveTaskLink,
  type SlackReactionAdded,
} from "./reaction-added";

/**
 * One agent fix requested from Slack. The workflow that does the fix reads
 * the request comment this posts on the task's GitHub issue, and echoes the
 * link's id back in its result comment, so the result can find whom to tell.
 */
export const AGENT_RUN_RESOURCE_TYPE = "agent_run";
export const AGENT_FIX_LABEL = "agent:fix";

export type AgentRunMetadata = {
  slackUserId: string;
  githubLogin: string | null;
  channel: string;
  messageTs: string;
  threadTs: string;
  /** `owner/name` of the issue repository the request was posted in. */
  repository: string;
  issueNumber: number;
};

type SlackAppIntegration = { id: string; projectId: string; config: string };

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export function formatAgentRequestComment({
  githubLogin,
  runId,
}: {
  githubLogin: string | null;
  runId: string;
}): string {
  const visible = githubLogin
    ? `🤖 Agent fix requested by @${githubLogin}`
    : "🤖 Agent fix requested from Slack.";

  return `${visible}\n\n<!-- agent-fix requester=${githubLogin ?? ""} run=${runId} -->`;
}

async function findGithubIntegration(projectId: string) {
  return db.query.integrationTable.findFirst({
    where: and(
      eq(integrationTable.type, "github"),
      eq(integrationTable.projectId, projectId),
      eq(integrationTable.isActive, true),
    ),
  });
}

/**
 * The agent reaction: the same task the filing reaction would give the
 * message, its GitHub issue, and a labelled request on that issue. Everything
 * that could refuse the run is checked before a task is filed, so a refused
 * reaction leaves nothing behind.
 */
export async function startAgentRun({
  event,
  message,
  integration,
  client,
}: {
  event: SlackReactionAdded;
  message: SlackMessage;
  integration: SlackAppIntegration;
  client: SlackClient;
}): Promise<void> {
  const reply = (text: string) =>
    replyQuietly(client, {
      channel: event.channel,
      threadTs: message.threadTs,
      text,
    });

  // The agent opens pull requests on the reactor's behalf, so an unknown
  // Slack account is refused rather than run anonymously.
  const kaneoUserId = await resolveKaneoUserId(
    client,
    event.userId,
    integration.projectId,
  );

  if (!kaneoUserId) {
    await reply(
      "Only members of this Kaneo workspace can start an agent fix. Sign in to Kaneo with the email your Slack account uses, then react again.",
    );
    return;
  }

  const githubIntegration = await findGithubIntegration(integration.projectId);
  const githubApp = getGithubApp();

  if (!githubIntegration || !githubApp) {
    await reply(
      "Agent fixes need this Kaneo project to be connected to GitHub, and it isn't.",
    );
    return;
  }

  const githubConfig = JSON.parse(githubIntegration.config) as GitHubConfig;
  const owner = githubConfig.repositoryOwner;
  const repo = githubConfig.repositoryName;

  const filed = await findOrFileTask({
    event,
    message,
    integration,
    resolveAssignee: async () => kaneoUserId,
    client,
  });

  if (!filed) {
    return;
  }

  const link = await resolveTaskLink(filed.task);
  if (!link) {
    return;
  }

  const prepareIssue = async () => {
    const installationId =
      githubConfig.installationId ??
      (await getInstallationIdForRepo(owner, repo));
    const octokit = await githubApp.getInstallationOctokit(installationId);

    const task = await db.query.taskTable.findFirst({
      where: eq(taskTable.id, filed.task.id),
    });

    if (!task) {
      throw new Error("the filed task disappeared");
    }

    // Awaited here rather than left to the task.created handler: the request
    // comment needs the issue number now, and the handler's lock makes the two
    // agree on a single issue.
    const issue = await ensureIssueForTask(
      octokit,
      {
        taskId: task.id,
        projectId: task.projectId,
        number: task.number,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        assigneeId: task.userId,
      },
      {
        integrationId: githubIntegration.id,
        projectId: githubIntegration.projectId,
        config: githubConfig as unknown as Record<string, unknown>,
      },
    );

    if (!issue) {
      throw new Error("no GitHub issue for the task");
    }

    return { octokit, issueNumber: issue.issueNumber };
  };

  let prepared: Awaited<ReturnType<typeof prepareIssue>>;
  try {
    prepared = await prepareIssue();
  } catch (error) {
    console.error("[Slack App] Could not prepare an agent run:", error);
    await reply(
      `Couldn't start the agent for ${link.identifier}: GitHub didn't answer. Try reacting again later.`,
    );
    return;
  }

  const { octokit, issueNumber } = prepared;

  // Unlinked is fine: the run goes ahead and simply tags nobody on GitHub.
  let githubLogin: string | null = null;
  try {
    githubLogin = await getGithubLoginForUser(kaneoUserId, octokit);
  } catch (error) {
    console.error("[Slack App] Could not resolve a GitHub login:", error);
  }

  const metadata: AgentRunMetadata = {
    slackUserId: event.userId,
    githubLogin,
    channel: event.channel,
    messageTs: event.ts,
    threadTs: message.threadTs,
    repository: `${owner}/${repo}`,
    issueNumber,
  };

  // One request per issue at a time. `agent:fix` stays on the issue until the
  // workflow reports, so its presence means a run is queued or in progress;
  // a second request then would collapse into the same label event and be
  // lost, so it is refused instead. The lock closes the window between
  // checking for the label and adding it.
  const outcome = await withKeyedLock(
    `agent-run:${owner}/${repo}#${issueNumber}`,
    async (): Promise<"started" | "busy" | "duplicate" | "failed"> => {
      try {
        const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
          owner,
          repo,
          issue_number: issueNumber,
        });
        if (labels.some((label) => label.name === AGENT_FIX_LABEL)) {
          return "busy";
        }
      } catch (error) {
        console.error("[Slack App] Could not read the issue's labels:", error);
        return "failed";
      }

      let runId: string;
      try {
        // Keyed by the reaction's own event timestamp: a redelivery of this
        // reaction collides on the unique index, while reacting again later is
        // a new run. Without one, the message itself is the key, so it runs
        // once.
        const created = await createExternalLink({
          taskId: filed.task.id,
          integrationId: integration.id,
          resourceType: AGENT_RUN_RESOURCE_TYPE,
          externalId: `${event.channel}:${event.ts}:${event.eventTs ?? event.ts}`,
          url: link.url,
          title: filed.title,
          metadata,
        });
        runId = created.id;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "duplicate";
        }
        throw error;
      }

      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body: formatAgentRequestComment({ githubLogin, runId }),
        });

        // Called directly rather than through addLabelsToIssue, which
        // swallows failures: without the label nothing runs, and the thread
        // must not say otherwise. GitHub creates the label on first use.
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels: [AGENT_FIX_LABEL],
        });
      } catch (error) {
        console.error("[Slack App] Could not request the agent run:", error);
        return "failed";
      }

      return "started";
    },
  );

  if (outcome === "duplicate") {
    return;
  }

  if (outcome === "busy") {
    await reply(
      `The agent is already working on ${link.identifier}, so this reaction started nothing new. If that run looks stuck, remove the \`agent:fix\` label from its GitHub issue and react again.`,
    );
    return;
  }

  if (outcome === "failed") {
    await reply(
      `Couldn't start the agent for ${link.identifier}: GitHub refused the request. React again to retry.`,
    );
    return;
  }

  await reply(`🤖 Agent picked up ${link.identifier} — ${link.url}`);
}
