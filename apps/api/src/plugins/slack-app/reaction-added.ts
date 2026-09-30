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
import { replyQuietly, type SlackClient } from "./client";
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
};

type LinkedTask = { id: string; number: number | null; projectId: string };

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function resolveTaskLink(task: LinkedTask) {
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
async function resolveKaneoUserId(
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

  const matching = integrations.filter((integration) => {
    const config = normalizeSlackAppConfig(
      JSON.parse(integration.config) as SlackAppConfig,
    );
    return config.emoji === event.reaction.toLowerCase();
  });

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

  const externalId = `${event.channel}:${event.ts}`;

  // Reacting to a reply inside a thread must answer in that thread, not start a
  // new one, so the parent is resolved before either branch replies.
  const message = await client.getMessage({
    channel: event.channel,
    ts: event.ts,
  });

  if (!message) {
    return;
  }

  for (const integration of matching) {
    const existingLink = await findExternalLink(
      integration.id,
      SLACK_MESSAGE_RESOURCE_TYPE,
      externalId,
    );

    if (existingLink) {
      const task = await db.query.taskTable.findFirst({
        where: eq(taskTable.id, existingLink.taskId),
      });
      const link = task ? await resolveTaskLink(task) : null;

      if (link) {
        await replyQuietly(client, {
          channel: event.channel,
          threadTs: message.threadTs,
          text: `Already filed as ${link.identifier} — ${link.url}`,
        });
      }

      continue;
    }

    const [assigneeId, permalink, channelName, authorName] = await Promise.all([
      resolveKaneoUserId(client, event.userId, integration.projectId),
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
      const winningLink = winningTask
        ? await resolveTaskLink(winningTask)
        : null;

      if (winningLink) {
        await replyQuietly(client, {
          channel: event.channel,
          threadTs: message.threadTs,
          text: `Already filed as ${winningLink.identifier} — ${winningLink.url}`,
        });
      }

      continue;
    }

    const link = await resolveTaskLink(createdTask);

    if (link) {
      // Not awaited: Slack expects the events endpoint to answer within
      // seconds, and the task is already filed whatever enrichment does. A
      // started run replies once it settles, with the rewritten title.
      const enriching = startTaskEnrichment(
        {
          taskId: createdTask.id,
          projectId: createdTask.projectId,
          prefix: link.prefix,
          taskNumber: createdTask.number,
          url: link.url,
          original: { title, description },
          channel: event.channel,
          threadTs: message.threadTs,
          reactedTs: event.ts,
          actorId: assigneeId ?? null,
        },
        { client },
      );

      if (!enriching) {
        await replyQuietly(client, {
          channel: event.channel,
          threadTs: message.threadTs,
          text: formatCreatedReply({
            identifier: link.identifier,
            title,
            url: link.url,
          }),
        });
      }
    }
  }
}
