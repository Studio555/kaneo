import { and, desc, eq } from "drizzle-orm";
import db from "../../database";
import {
  externalLinkTable,
  integrationTable,
  taskTable,
} from "../../database/schema";
import { findExternalLink } from "../github/services/link-manager";
import { findAllIntegrationsByRepoName } from "../github/services/task-service";
import { escapeSlack } from "../slack/events";
import { AGENT_RUN_RESOURCE_TYPE, type AgentRunMetadata } from "./agent-run";
import { directMessageQuietly, type SlackClient } from "./client";
import { normalizeSlackAppConfig, type SlackAppConfig } from "./config";
import { resolveTaskLink } from "./reaction-added";

/**
 * The agent-fix workflow posts its outcome with the repository's
 * GITHUB_TOKEN, which comments as this account. Anyone else writing the
 * marker is ignored, so a person cannot make Kaneo DM someone by quoting it.
 */
export const AGENT_RESULT_AUTHOR = "github-actions[bot]";

const MARKER_PATTERN = /<!--\s*agent-fix\s+([^>]*?)\s*-->/;
const MAX_DETAIL_LENGTH = 1500;

export type AgentResult = {
  result: "pr_opened" | "declined" | "failed";
  reason: string;
  run: string;
  pr: string;
  /** The comment without its marker, as the workflow wrote it for people. */
  text: string;
};

export function parseAgentResultComment(body: string): AgentResult | null {
  const match = MARKER_PATTERN.exec(body);
  if (!match?.[1]) {
    return null;
  }

  const fields = new Map<string, string>();
  for (const pair of match[1].split(/\s+/)) {
    const separator = pair.indexOf("=");
    if (separator > 0) {
      fields.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  // The request comment carries the same prefix with `requester=`; only a
  // marker naming a result is the workflow's answer.
  const result = fields.get("result");
  if (result !== "pr_opened" && result !== "declined" && result !== "failed") {
    return null;
  }

  return {
    result,
    reason: fields.get("reason") ?? "",
    run: fields.get("run") ?? "",
    pr: fields.get("pr") ?? "",
    text: body.replace(MARKER_PATTERN, "").trim(),
  };
}

function parseMetadata(metadata: string | null): AgentRunMetadata | null {
  if (!metadata) {
    return null;
  }

  try {
    return JSON.parse(metadata) as AgentRunMetadata;
  } catch {
    return null;
  }
}

/**
 * The run the result answers: the one its marker names, provided it was
 * requested on this very issue, else the issue's newest run. A run id copied
 * onto another issue therefore reaches nobody.
 */
async function findAgentRun({
  runId,
  repository,
  issueNumber,
}: {
  runId: string;
  repository: { owner: string; name: string };
  issueNumber: number;
}) {
  const fullName = `${repository.owner}/${repository.name}`.toLowerCase();
  const belongsHere = (metadata: AgentRunMetadata | null) =>
    metadata?.issueNumber === issueNumber &&
    metadata.repository?.toLowerCase() === fullName;

  if (runId) {
    const link = await db.query.externalLinkTable.findFirst({
      where: and(
        eq(externalLinkTable.id, runId),
        eq(externalLinkTable.resourceType, AGENT_RUN_RESOURCE_TYPE),
      ),
    });
    const metadata = link ? parseMetadata(link.metadata) : null;

    // A run named outright but belonging elsewhere is nobody's here: falling
    // back would hand its result to whoever last asked on this issue.
    return link && metadata && belongsHere(metadata)
      ? { link, metadata }
      : null;
  }

  const integrations = await findAllIntegrationsByRepoName(
    repository.owner,
    repository.name,
  );

  for (const integration of integrations) {
    const issueLink = await findExternalLink(
      integration.id,
      "issue",
      issueNumber.toString(),
    );

    if (!issueLink) {
      continue;
    }

    const link = await db.query.externalLinkTable.findFirst({
      where: and(
        eq(externalLinkTable.taskId, issueLink.taskId),
        eq(externalLinkTable.resourceType, AGENT_RUN_RESOURCE_TYPE),
      ),
      orderBy: desc(externalLinkTable.createdAt),
    });
    const metadata = link ? parseMetadata(link.metadata) : null;

    if (link && metadata && belongsHere(metadata)) {
      return { link, metadata };
    }
  }

  return null;
}

function truncate(text: string): string {
  return text.length <= MAX_DETAIL_LENGTH
    ? text
    : `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}

export function formatRequesterMessage(
  result: AgentResult,
  identifier: string,
): string {
  if (result.result === "pr_opened") {
    return `Your agent fix for ${identifier} is ready for review: ${result.pr}`;
  }

  const verb = result.result === "declined" ? "declined" : "couldn't finish";
  const detail = result.text ? `\n\n${escapeSlack(truncate(result.text))}` : "";

  return `The agent ${verb} ${identifier}.${detail}`;
}

export const CODEX_SIGNED_OUT_REMINDER =
  "Codex on the agent Mac is signed out, so agent fixes are failing. Sign it in again: `ssh agent-mac` then `codex login --device-auth`.";

/**
 * Tells the person who reacted how their agent fix ended, and the maintainer
 * when the runner needs a human. Returns false when the comment is not an
 * agent result, so the caller carries on with ordinary comment handling.
 */
export async function handleAgentResultComment(
  {
    body,
    authorLogin,
    repository,
    issueNumber,
  }: {
    body: string;
    authorLogin: string;
    repository: { owner: string; name: string };
    issueNumber: number;
  },
  { client }: { client: SlackClient },
): Promise<boolean> {
  if (authorLogin !== AGENT_RESULT_AUTHOR) {
    return false;
  }

  const result = parseAgentResultComment(body);
  if (!result) {
    return false;
  }

  const run = await findAgentRun({
    runId: result.run,
    repository,
    issueNumber,
  });

  if (!run) {
    console.error(
      `[Slack App] Agent result on ${repository.owner}/${repository.name}#${issueNumber} matches no agent run`,
    );
    return true;
  }

  const [task, integration] = await Promise.all([
    db.query.taskTable.findFirst({
      where: eq(taskTable.id, run.link.taskId),
    }),
    run.link.integrationId
      ? db.query.integrationTable.findFirst({
          where: eq(integrationTable.id, run.link.integrationId),
        })
      : undefined,
  ]);

  const taskLink = task ? await resolveTaskLink(task) : null;
  const identifier = taskLink?.identifier ?? `issue #${issueNumber}`;

  const config = integration
    ? normalizeSlackAppConfig(JSON.parse(integration.config) as SlackAppConfig)
    : null;
  const maintainer = config?.maintainerSlackUserId;
  const needsMaintainer = result.reason === "codex_signed_out" && !!maintainer;

  let requesterText = formatRequesterMessage(result, identifier);

  // The maintainer reacting to their own task gets one message, not two.
  if (needsMaintainer && maintainer === run.metadata.slackUserId) {
    requesterText = `${requesterText}\n\n${CODEX_SIGNED_OUT_REMINDER}`;
  } else if (needsMaintainer && maintainer) {
    await directMessageQuietly(client, {
      userId: maintainer,
      text: CODEX_SIGNED_OUT_REMINDER,
    });
  }

  await directMessageQuietly(client, {
    userId: run.metadata.slackUserId,
    text: requesterText,
  });

  return true;
}
