import { and, asc, eq, sql } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  integrationTable,
  projectTable,
  taskTable,
  userTable,
} from "../../database/schema";
import createTask from "../../task/controllers/create-task";
import {
  filterAssignableUsers,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import {
  createExternalLink,
  findExternalLink,
} from "../github/services/link-manager";
import { startAgentRun } from "./agent-run";
import { replyQuietly, type SlackClient, type SlackMessage } from "./client";
import { normalizeSlackAppConfig, type SlackAppConfig } from "./config";
import { startTaskEnrichment } from "./enrich-task";
import {
  deriveTaskTitle,
  formatCreatedReply,
  formatTaskDescription,
} from "./format";

export const SLACK_MESSAGE_RESOURCE_TYPE = "slack_message";

export type SlackReactionAdded = {
  reaction: string;
  userId: string;
  itemType: string;
  channel: string;
  ts: string;
  /** Unique per reaction; a redelivery of the same reaction repeats it. */
  eventTs?: string;
};

export type LinkedTask = {
  id: string;
  number: number | null;
  projectId: string;
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

export async function resolveTaskLink(task: LinkedTask) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, task.projectId),
  });

  if (!project) {
    return null;
  }

  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";

  const prefix = project.slug.toUpperCase();

  return {
    workspaceId: project.workspaceId,
    prefix,
    identifier: `${prefix}-${task.number}`,
    url: `${clientUrl}/dashboard/workspace/${project.workspaceId}/project/${task.projectId}/task/${task.id}`,
  };
}

/**
 * The reacting person becomes the task's assignee when Slack and Kaneo agree on
 * their email address. Anything else — a Slack account with a hidden email, a
 * guest, someone who has never signed in to Kaneo — files the task unassigned
 * rather than guessing.
 */
export async function resolveKaneoUserId(
  client: SlackClient,
  slackUserId: string,
  projectId: string,
): Promise<string | undefined> {
  const email = await client.getUserEmail(slackUserId);
  if (!email) {
    return undefined;
  }

  const user = await db.query.userTable.findFirst({
    where: eq(sql`lower(${userTable.email})`, email.toLowerCase()),
  });

  if (!user) {
    return undefined;
  }

  // An email match is not membership. Assigning a non-member makes createTask
  // throw, which would lose the task entirely rather than file it unassigned.
  const workspaceId = await getProjectWorkspaceId(projectId);
  const assignable = await filterAssignableUsers([user.id], workspaceId);

  return assignable.has(user.id) ? user.id : undefined;
}

async function resolveFirstColumnSlug(projectId: string): Promise<string> {
  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.kind, "board"),
    ),
    orderBy: asc(columnTable.position),
  });

  return column?.slug ?? "to-do";
}

/**
 * Decoration the task can do without: the channel name needs channels:read and
 * the author name needs the user to still exist. Neither is worth losing the
 * task over, and the description already reads correctly without them.
 */
async function optional<T>(work: Promise<T | null>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    console.error("[Slack App] Optional message detail unavailable:", error);
    return null;
  }
}

export type FiledTask = {
  task: LinkedTask;
  /** False when the message was already linked, by an earlier reaction or a racing delivery. */
  created: boolean;
  title: string;
  description: string;
  /** Who a newly filed task was assigned to; undefined when it was already filed. */
  assigneeId: string | undefined;
};

/**
 * The task a Slack message maps to, filing it when it has none yet. Shared by
 * the filing reaction and the agent reaction, so both agree on what "the
 * task for this message" means.
 */
export async function findOrFileTask({
  event,
  message,
  integration,
  resolveAssignee,
  client,
}: {
  event: SlackReactionAdded;
  message: SlackMessage;
  integration: SlackAppIntegration;
  /** Only called when the task is actually filed, so a known message costs no Slack lookups. */
  resolveAssignee: () => Promise<string | undefined>;
  client: SlackClient;
}): Promise<FiledTask | null> {
  const externalId = `${event.channel}:${event.ts}`;

  const existingLink = await findExternalLink(
    integration.id,
    SLACK_MESSAGE_RESOURCE_TYPE,
    externalId,
  );

  if (existingLink) {
    const task = await db.query.taskTable.findFirst({
      where: eq(taskTable.id, existingLink.taskId),
    });

    return task
      ? {
          task,
          created: false,
          title: task.title,
          description: task.description ?? "",
          assigneeId: undefined,
        }
      : null;
  }

  const [assigneeId, permalink, channelName, authorName] = await Promise.all([
    resolveAssignee(),
    client.getPermalink({ channel: event.channel, ts: event.ts }),
    optional(client.getChannelName(event.channel)),
    message.userId
      ? optional(client.getUserName(message.userId))
      : Promise.resolve(null),
  ]);

  const status = await resolveFirstColumnSlug(integration.projectId);

  const title = deriveTaskTitle(message.text);
  const description = formatTaskDescription({
    text: message.text,
    authorName,
    channelName,
    permalink: permalink ?? "",
  });

  const createdTask = await createTask({
    projectId: integration.projectId,
    currentUserId: assigneeId ?? "",
    userId: assigneeId,
    title,
    description,
    status,
    priority: "no-priority",
  });

  try {
    await createExternalLink({
      taskId: createdTask.id,
      integrationId: integration.id,
      resourceType: SLACK_MESSAGE_RESOURCE_TYPE,
      externalId,
      url: permalink ?? "",
      title,
      metadata: {
        channel: event.channel,
        messageTs: event.ts,
        threadTs: message.threadTs,
        reactedBy: event.userId,
        createdFrom: "slack",
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // A concurrent reaction or a Slack retry linked this message first. The
    // unique index is what makes that race safe; this side just clears the
    // task it lost with, so the message still maps to exactly one task.
    await db.delete(taskTable).where(eq(taskTable.id, createdTask.id));

    const winner = await findExternalLink(
      integration.id,
      SLACK_MESSAGE_RESOURCE_TYPE,
      externalId,
    );
    const winningTask = winner
      ? await db.query.taskTable.findFirst({
          where: eq(taskTable.id, winner.taskId),
        })
      : null;

    return winningTask
      ? {
          task: winningTask,
          created: false,
          title: winningTask.title,
          description: winningTask.description ?? "",
          assigneeId: undefined,
        }
      : null;
  }

  return { task: createdTask, created: true, title, description, assigneeId };
}

type ReactionKind = "file" | "agent";

export async function handleReactionAdded(
  event: SlackReactionAdded,
  { client }: { client: SlackClient },
): Promise<void> {
  if (event.itemType !== "message") {
    return;
  }

  const integrations = await db.query.integrationTable.findMany({
    where: and(
      eq(integrationTable.type, "slack-app"),
      eq(integrationTable.isActive, true),
    ),
  });

  const reaction = event.reaction.toLowerCase();
  const matching: Array<{
    integration: SlackAppIntegration;
    kind: ReactionKind;
  }> = [];

  for (const integration of integrations) {
    const config = normalizeSlackAppConfig(
      JSON.parse(integration.config) as SlackAppConfig,
    );

    if (config.emoji === reaction) {
      matching.push({ integration, kind: "file" });
    } else if (config.agentEmoji === reaction) {
      matching.push({ integration, kind: "agent" });
    }
  }

  if (matching.length === 0) {
    return;
  }

  // The emoji is the only routing signal there is, so more than one claimant is
  // ambiguous. Copying the message into every one of them would carry private
  // channel content across workspace boundaries; file it nowhere instead.
  if (matching.length > 1) {
    console.error(
      `[Slack App] ${matching.length} integrations claim :${event.reaction}:; refusing to file the message`,
    );
    return;
  }

  // Reacting to a reply inside a thread must answer in that thread, not start a
  // new one, so the parent is resolved before either branch replies.
  const message = await client.getMessage({
    channel: event.channel,
    ts: event.ts,
  });

  if (!message) {
    return;
  }

  for (const { integration, kind } of matching) {
    if (kind === "agent") {
      await startAgentRun({ event, message, integration, client });
      continue;
    }

    await fileReactedMessage({ event, message, integration, client });
  }
}

async function fileReactedMessage({
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
  const filed = await findOrFileTask({
    event,
    message,
    integration,
    resolveAssignee: () =>
      resolveKaneoUserId(client, event.userId, integration.projectId),
    client,
  });

  if (!filed) {
    return;
  }

  const link = await resolveTaskLink(filed.task);

  if (!link) {
    return;
  }

  if (!filed.created) {
    await replyQuietly(client, {
      channel: event.channel,
      threadTs: message.threadTs,
      text: `Already filed as ${link.identifier} — ${link.url}`,
    });
    return;
  }

  // Not awaited: Slack expects the events endpoint to answer within
  // seconds, and the task is already filed whatever enrichment does. A
  // started run replies once it settles, with the rewritten title.
  const enriching = startTaskEnrichment(
    {
      taskId: filed.task.id,
      projectId: filed.task.projectId,
      prefix: link.prefix,
      taskNumber: filed.task.number,
      url: link.url,
      original: { title: filed.title, description: filed.description },
      channel: event.channel,
      threadTs: message.threadTs,
      reactedTs: event.ts,
      actorId: filed.assigneeId ?? null,
    },
    { client },
  );

  if (!enriching) {
    await replyQuietly(client, {
      channel: event.channel,
      threadTs: message.threadTs,
      text: formatCreatedReply({
        identifier: link.identifier,
        title: filed.title,
        url: link.url,
      }),
    });
  }
}
