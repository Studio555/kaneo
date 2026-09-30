import { readFileSync } from "node:fs";
import { and, desc, eq, ne } from "drizzle-orm";
import createComment from "../../activity/controllers/create-comment";
import db from "../../database";
import { taskTable } from "../../database/schema";
import updateTaskDescription from "../../task/controllers/update-task-description";
import updateTaskTitle from "../../task/controllers/update-task-title";
import {
  replyQuietly,
  type SlackClient,
  type SlackFile,
  type SlackThreadMessage,
} from "./client";
import { formatCreatedReply } from "./format";
import { type EnrichmentUsage, requestEnrichment } from "./openai";

const DEFAULT_MODEL = "gpt-5.6-luna";
const THREAD_MAX_MESSAGES = 200;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_COUNT = 6;
const RECENT_TASKS_LIMIT = 100;
// Each run holds up to six images in memory and a 90 s model call; a burst of
// reactions should not stack an unbounded number of them.
const MAX_IN_FLIGHT = 4;
const NOT_GIVEN = "Not given in the thread.";
const FOOTER = "_Triaged by Kaneo — edit freely._";
const KEPT = "kept — a person edited it first";

export type TaskEnrichmentRequest = {
  taskId: string;
  projectId: string;
  /** e.g. "PS" — the prefix of `PS-7`. */
  prefix: string;
  taskNumber: number | null;
  url: string;
  original: { title: string; description: string };
  channel: string;
  threadTs: string;
  reactedTs: string;
  /** Who the task was filed as; null when the reactor has no Kaneo account. */
  actorId: string | null;
};

let inFlight = 0;

/**
 * Keeps only the root, the reacted message and the newest others, in order, so
 * a long thread still shows the model where it started and what was flagged.
 */
export function capThread(
  messages: SlackThreadMessage[],
  { rootTs, reactedTs }: { rootTs: string; reactedTs: string },
): { kept: SlackThreadMessage[]; omitted: number } {
  if (messages.length <= THREAD_MAX_MESSAGES) {
    return { kept: messages, omitted: 0 };
  }

  const pinned = new Set([rootTs, reactedTs]);
  const pinnedCount = messages.filter((m) => pinned.has(m.ts)).length;
  const others = messages.filter((m) => !pinned.has(m.ts));
  const recent = new Set(
    others
      .slice(others.length - Math.max(THREAD_MAX_MESSAGES - pinnedCount, 0))
      .map((m) => m.ts),
  );
  const kept = messages.filter((m) => pinned.has(m.ts) || recent.has(m.ts));

  return { kept, omitted: messages.length - kept.length };
}

/** The reacted message's images first, then the root's, then newest replies. */
export function pickImageCandidates(
  messages: SlackThreadMessage[],
  { rootTs, reactedTs }: { rootTs: string; reactedTs: string },
): SlackFile[] {
  const first = [...new Set([reactedTs, rootTs])];
  const ordered = [
    ...first.flatMap((ts) => messages.filter((m) => m.ts === ts)),
    ...[...messages].reverse().filter((m) => !first.includes(m.ts)),
  ];

  return ordered
    .flatMap((m) => m.files)
    .filter(
      (file) =>
        file.mimetype.startsWith("image/") &&
        file.size > 0 &&
        file.size <= IMAGE_MAX_BYTES &&
        file.url,
    );
}

async function downloadImages(
  client: SlackClient,
  candidates: SlackFile[],
): Promise<{ names: string[]; dataUrls: string[] }> {
  const names: string[] = [];
  const dataUrls: string[] = [];

  for (const file of candidates) {
    if (dataUrls.length >= IMAGE_MAX_COUNT) break;

    try {
      const bytes = await client.downloadImage(file.url);
      if (bytes.length > IMAGE_MAX_BYTES) continue;
      names.push(file.name);
      dataUrls.push(`data:${file.mimetype};base64,${bytes.toString("base64")}`);
    } catch (error) {
      console.error(`[Slack App] Skipping image ${file.name}:`, error);
    }
  }

  return { names, dataUrls };
}

async function resolveAuthors(
  client: SlackClient,
  messages: SlackThreadMessage[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(messages.map((m) => m.userId).filter((id) => id !== null)),
  ];
  const names = await Promise.all(
    ids.map((id) => client.getUserName(id).catch(() => null)),
  );

  return new Map(ids.map((id, index) => [id, names[index] || id]));
}

function formatThread(
  messages: SlackThreadMessage[],
  {
    reactedTs,
    omitted,
    authors,
  }: { reactedTs: string; omitted: number; authors: Map<string, string> },
): string {
  const blocks = messages.map((m) => {
    const author = (m.userId && authors.get(m.userId)) || "unknown";
    const marks = m.ts === reactedTs ? " (reacted message)" : "";
    const files = m.files.length
      ? ` (attached ${m.files.map((f) => f.name).join(", ")})`
      : "";
    return `[${author}]${marks}${files}\n${m.text.trim()}`;
  });

  if (omitted > 0) {
    blocks.unshift(
      `(Thread truncated: ${omitted} messages omitted. Shown are the root, the reacted message and the most recent replies.)`,
    );
  }

  return blocks.join("\n\n");
}

export function assembleDescription(
  description: {
    summary: string;
    observed: string;
    where: string;
    repro: string;
    openQuestions: string[];
  },
  original: string,
): string {
  const sections = [
    `**Summary**\n${description.summary || NOT_GIVEN}`,
    `**Observed**\n${description.observed || NOT_GIVEN}`,
    `**Where**\n${description.where || NOT_GIVEN}`,
  ];
  if (description.repro) {
    sections.push(`**Repro**\n${description.repro}`);
  }
  if (description.openQuestions.length > 0) {
    sections.push(
      `**Open questions**\n${description.openQuestions.map((q) => `- ${q}`).join("\n")}`,
    );
  }

  return `${sections.join("\n\n")}\n\n---\n\n${original}\n\n${FOOTER}`;
}

function logRun(fields: {
  taskId: string;
  outcome: string;
  images?: number;
  threadMessages?: number;
  duplicate?: number | null;
  attempts?: number;
  usage?: EnrichmentUsage;
  error?: string;
}) {
  console.info(`[Slack App] enrichment ${JSON.stringify(fields)}`);
}

export async function enrichTask(
  request: TaskEnrichmentRequest,
  {
    client,
    apiKey,
    model,
  }: { client: SlackClient; apiKey: string; model: string },
): Promise<void> {
  const { taskId, projectId, reactedTs } = request;
  const rootTs = request.threadTs;

  const { kept, omitted } = capThread(
    await client.getThread({ channel: request.channel, threadTs: rootTs }),
    { rootTs, reactedTs },
  );
  const [authors, images, recentTasks] = await Promise.all([
    resolveAuthors(client, kept),
    downloadImages(client, pickImageCandidates(kept, { rootTs, reactedTs })),
    db
      .select({ number: taskTable.number, title: taskTable.title })
      .from(taskTable)
      .where(and(eq(taskTable.projectId, projectId), ne(taskTable.id, taskId)))
      .orderBy(desc(taskTable.createdAt))
      .limit(RECENT_TASKS_LIMIT),
  ]);
  const offered = new Set(
    recentTasks.flatMap((task) => (task.number === null ? [] : [task.number])),
  );

  const text = [
    `Task ${request.prefix}-${request.taskNumber ?? "?"} as filed by the Slack bot.`,
    `Title: ${request.original.title}`,
    `Description:\n${request.original.description}`,
    `Slack thread (oldest first):\n${formatThread(kept, { reactedTs, omitted, authors }) || "(empty)"}`,
    `Images attached, in order: ${images.names.join(", ") || "none"}`,
    `Recent tasks in this project (number: title):\n${
      recentTasks
        .filter((task) => task.number !== null)
        .map((task) => `${task.number}: ${task.title}`)
        .join("\n") || "(none)"
    }`,
  ].join("\n\n");

  const result = await requestEnrichment({
    apiKey,
    model,
    text,
    imageDataUrls: images.dataUrls,
  });
  const base = {
    taskId,
    images: images.dataUrls.length,
    threadMessages: kept.length,
    attempts: result.attempts,
    usage: result.usage,
  };

  if (!result.enrichment) {
    logRun({ ...base, outcome: "invalid_output", error: result.error ?? "" });
    return;
  }

  const { enrichment } = result;
  const duplicate =
    enrichment.possibleDuplicateOf !== null &&
    offered.has(enrichment.possibleDuplicateOf)
      ? enrichment.possibleDuplicateOf
      : null;

  // The null actor is written as no user; the controllers take a string.
  const currentUserId = request.actorId ?? "";
  const current = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!current) {
    logRun({ ...base, outcome: "task_deleted", duplicate });
    return;
  }

  const writeTitle = current.title === request.original.title;
  if (writeTitle) {
    await updateTaskTitle({
      id: taskId,
      title: enrichment.title,
      currentUserId,
    });
  }

  const writeDescription =
    (current.description ?? "") === request.original.description;
  if (writeDescription) {
    await updateTaskDescription({
      id: taskId,
      description: assembleDescription(
        enrichment.description,
        request.original.description,
      ),
      currentUserId,
    });
  }

  const imageNote = base.images
    ? ` and ${base.images} image${base.images === 1 ? "" : "s"}`
    : "";
  const lines = [
    `Rewrote this task from the Slack thread${imageNote}.`,
    `**Title:** ${writeTitle ? enrichment.title : KEPT}`,
    `**Description:** ${writeDescription ? "rewritten from the thread, above the original report" : KEPT}`,
  ];
  if (duplicate !== null) {
    lines.push(`Possible duplicate of ${request.prefix}-${duplicate}`);
  }

  await createComment(
    taskId,
    currentUserId,
    lines.join("\n\n"),
    request.actorId ? undefined : { userName: "Kaneo", source: "slack" },
  );

  logRun({
    ...base,
    outcome: writeTitle || writeDescription ? "updated" : "kept",
    duplicate,
  });
}

/**
 * A mounted secret file (`OPENAI_API_KEY_FILE`) wins over `OPENAI_API_KEY`, so a
 * deployment can keep the key out of its environment. The file is read per run,
 * so a rotated secret is picked up without a restart.
 */
export function readOpenAiApiKey(): string | null {
  const file = process.env.OPENAI_API_KEY_FILE;
  if (file) {
    try {
      return readFileSync(file, "utf8").trim() || null;
    } catch (error) {
      console.error("[Slack App] OPENAI_API_KEY_FILE is unreadable:", error);
      return null;
    }
  }
  return process.env.OPENAI_API_KEY || null;
}

/**
 * The thread gets a single reply once enrichment settles, carrying whatever
 * title the task ended up with, so a filing does not post twice. Nothing is
 * posted for a task deleted in the meantime.
 */
async function announceCreated(
  request: TaskEnrichmentRequest,
  client: SlackClient,
): Promise<void> {
  const task = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, request.taskId),
  });
  if (!task) {
    return;
  }

  await replyQuietly(client, {
    channel: request.channel,
    threadTs: request.threadTs,
    text: formatCreatedReply({
      identifier: `${request.prefix}-${request.taskNumber}`,
      title: task.title,
      url: request.url,
    }),
  });
}

/**
 * Fire-and-forget: the task is already filed, so nothing here may reject into
 * the Slack events handler or delay its answer. Returns whether a run started;
 * a started run owns the thread reply, otherwise the caller must post it.
 */
export function startTaskEnrichment(
  request: TaskEnrichmentRequest,
  { client }: { client: SlackClient },
): boolean {
  const apiKey = readOpenAiApiKey();
  if (!apiKey) {
    return false;
  }

  if (inFlight >= MAX_IN_FLIGHT) {
    logRun({ taskId: request.taskId, outcome: "skipped_busy" });
    return false;
  }

  inFlight++;
  const model = process.env.SLACK_TRIAGE_MODEL || DEFAULT_MODEL;

  enrichTask(request, { client, apiKey, model })
    .catch((error) => {
      logRun({
        taskId: request.taskId,
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .then(() => announceCreated(request, client))
    .catch((error) => {
      console.error("[Slack App] Failed to announce the task:", error);
    })
    .finally(() => {
      inFlight--;
    });

  return true;
}
