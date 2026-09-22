import { eq } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";
import { findExternalLinkByTaskAndType } from "../github/services/link-manager";
import type { PluginContext, TaskStatusChangedEvent } from "../types";
import { createSlackClient } from "./client";
import { SLACK_MESSAGE_RESOURCE_TYPE } from "./reaction-added";

type CompletionReporter = {
  postThreadReply(params: {
    channel: string;
    threadTs: string;
    text: string;
  }): Promise<void>;
  addReaction(params: {
    channel: string;
    ts: string;
    name: string;
  }): Promise<void>;
};

const DONE_REACTION = "white_check_mark";

type SlackMessageLinkMetadata = {
  channel?: string;
  messageTs?: string;
  threadTs?: string;
};

function parseMetadata(metadata: unknown): SlackMessageLinkMetadata | null {
  if (typeof metadata !== "string") {
    return null;
  }

  try {
    return JSON.parse(metadata) as SlackMessageLinkMetadata;
  } catch {
    return null;
  }
}

/**
 * "Done" is whichever column the project marks final, and a board may have more
 * than one. Only the crossing from unfinished to finished is worth a message;
 * shuffling between two final columns is not a second completion.
 */
export async function notifyTaskCompleted(
  event: TaskStatusChangedEvent,
  context: PluginContext,
  client: CompletionReporter,
): Promise<void> {
  const columns = await db.query.columnTable.findMany({
    where: eq(columnTable.projectId, event.projectId),
  });

  const isFinal = (slug: string) =>
    columns.some((column) => column.slug === slug && column.isFinal);

  if (!isFinal(event.newStatus) || isFinal(event.oldStatus)) {
    return;
  }

  const link = await findExternalLinkByTaskAndType(
    event.taskId,
    context.integrationId,
    SLACK_MESSAGE_RESOURCE_TYPE,
  );

  if (!link) {
    return;
  }

  const metadata = parseMetadata(link.metadata);
  const threadTs = metadata?.threadTs ?? metadata?.messageTs;

  if (!metadata?.channel || !threadTs) {
    return;
  }

  const [task, project] = await Promise.all([
    db.query.taskTable.findFirst({ where: eq(taskTable.id, event.taskId) }),
    db.query.projectTable.findFirst({
      where: eq(projectTable.id, event.projectId),
    }),
  ]);

  if (!task || !project) {
    return;
  }

  const identifier = `${project.slug.toUpperCase()}-${task.number}`;

  // Independent of each other: the reply and the checkmark each say the task is
  // done, and losing one is no reason to lose the other. Plugin handlers run off
  // the event bus, so neither may surface as a failed status change for the
  // person who moved the card.
  const announcements: Array<[string, Promise<void>]> = [
    [
      "completion reply",
      client.postThreadReply({
        channel: metadata.channel,
        threadTs,
        text: `✅ ${identifier} is done.`,
      }),
    ],
    [
      "completion reaction",
      client.addReaction({
        channel: metadata.channel,
        // The message that was reacted to, so the checkmark lands beside the
        // reaction that filed it rather than on the thread's parent.
        ts: metadata.messageTs ?? threadTs,
        name: DONE_REACTION,
      }),
    ],
  ];

  for (const [what, work] of announcements) {
    try {
      await work;
    } catch (error) {
      console.error(`[Slack App] Failed to post ${what}:`, error);
    }
  }
}

export async function handleTaskStatusChanged(
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    return;
  }

  await notifyTaskCompleted(event, context, createSlackClient(botToken));
}
