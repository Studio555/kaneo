import * as Sentry from "@sentry/node";

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 10_000;
const THREAD_PAGE_SIZE = 200;
// A runaway cursor must not keep a background job paging forever.
const THREAD_MAX_PAGES = 25;

export type SlackMessage = {
  text: string;
  userId: string | null;
  /** The thread to reply in: the parent thread when there is one, else the message itself. */
  threadTs: string;
};

export type SlackFile = {
  name: string;
  mimetype: string;
  size: number;
  url: string;
};

export type SlackThreadMessage = {
  ts: string;
  userId: string | null;
  text: string;
  files: SlackFile[];
};

export type SlackClient = {
  getMessage(params: {
    channel: string;
    ts: string;
  }): Promise<SlackMessage | null>;
  /** Every message of the thread rooted at `threadTs`, oldest first. */
  getThread(params: {
    channel: string;
    threadTs: string;
  }): Promise<SlackThreadMessage[]>;
  /** Downloads a private image file; needs the files:read scope. */
  downloadImage(url: string): Promise<Buffer>;
  getUserEmail(userId: string): Promise<string | null>;
  getUserName(userId: string): Promise<string | null>;
  getChannelName(channel: string): Promise<string | null>;
  getPermalink(params: { channel: string; ts: string }): Promise<string | null>;
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
  /** Lands in the app's Messages tab, which must be enabled under App Home. */
  postDirectMessage(params: { userId: string; text: string }): Promise<void>;
};

/**
 * Two Web API rules this has to respect. It answers 200 with
 * `{ ok: false, error }` for application-level failures, so the HTTP status
 * alone never tells you whether a call worked. And only the chat.* write
 * methods accept a JSON body: a read method such as conversations.replies
 * rejects one with `invalid_arguments`, so every call is form-encoded.
 */
async function callSlack<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    Sentry.addBreadcrumb({
      category: "integration",
      level: "info",
      data: { integration: "slack-app", method },
    });

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      params.set(key, String(value));
    }

    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: params.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Slack ${method} failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { ok: boolean; error?: string };

    if (!payload.ok) {
      throw new Error(`Slack ${method} failed: ${payload.error ?? "unknown"}`);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Slack ${method} timed out after ${SLACK_TIMEOUT_MS}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createSlackClient(botToken: string): SlackClient {
  return {
    async getMessage({ channel, ts }) {
      const payload = await callSlack<{
        messages?: Array<{
          text?: string;
          user?: string;
          ts?: string;
          thread_ts?: string;
        }>;
      }>(botToken, "conversations.replies", {
        channel,
        ts,
        oldest: ts,
        inclusive: true,
        limit: 1,
      });

      // Given a reply's timestamp, conversations.replies answers with the whole
      // thread, parent first. Only the message actually reacted to will do.
      const message = payload.messages?.find((entry) => entry.ts === ts);
      if (!message) {
        return null;
      }

      return {
        text: message.text ?? "",
        userId: message.user ?? null,
        threadTs: message.thread_ts ?? message.ts ?? ts,
      };
    },

    async getThread({ channel, threadTs }) {
      type RawMessage = {
        ts?: string;
        user?: string;
        text?: string;
        files?: Array<{
          name?: string;
          mimetype?: string;
          size?: number;
          url_private?: string;
        }>;
      };

      // Slack repeats the root on every page, hence the map keyed by ts.
      const byTs = new Map<string, RawMessage>();
      let cursor = "";

      for (let page = 0; page < THREAD_MAX_PAGES; page++) {
        const payload = await callSlack<{
          messages?: RawMessage[];
          response_metadata?: { next_cursor?: string };
        }>(botToken, "conversations.replies", {
          channel,
          ts: threadTs,
          limit: THREAD_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });

        for (const message of payload.messages ?? []) {
          if (message.ts && !byTs.has(message.ts)) {
            byTs.set(message.ts, message);
          }
        }

        cursor = payload.response_metadata?.next_cursor ?? "";
        if (!cursor) {
          break;
        }
      }

      return [...byTs.values()]
        .map((message) => ({
          ts: message.ts ?? "",
          userId: message.user ?? null,
          text: message.text ?? "",
          files: (message.files ?? []).map((file) => ({
            name: file.name ?? "",
            mimetype: file.mimetype ?? "",
            size: file.size ?? 0,
            url: file.url_private ?? "",
          })),
        }))
        .sort((a, b) => Number(a.ts) - Number(b.ts));
    },

    async downloadImage(url) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${botToken}` },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Slack file download failed with HTTP ${response.status}`,
          );
        }

        // Without files:read Slack answers 200 with its HTML sign-in page.
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          throw new Error(
            `Slack file download returned ${contentType || "no content type"}; is files:read granted?`,
          );
        }

        return Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async getUserEmail(userId) {
      const payload = await callSlack<{
        user?: { profile?: { email?: string } };
      }>(botToken, "users.info", { user: userId });

      return payload.user?.profile?.email ?? null;
    },

    async getUserName(userId) {
      const payload = await callSlack<{
        user?: {
          real_name?: string;
          name?: string;
          profile?: { display_name?: string };
        };
      }>(botToken, "users.info", { user: userId });

      return (
        payload.user?.profile?.display_name ||
        payload.user?.real_name ||
        payload.user?.name ||
        null
      );
    },

    async getChannelName(channel) {
      const payload = await callSlack<{ channel?: { name?: string } }>(
        botToken,
        "conversations.info",
        { channel },
      );

      return payload.channel?.name ?? null;
    },

    async getPermalink({ channel, ts }) {
      const payload = await callSlack<{ permalink?: string }>(
        botToken,
        "chat.getPermalink",
        { channel, message_ts: ts },
      );

      return payload.permalink ?? null;
    },

    async postThreadReply({ channel, threadTs, text }) {
      await callSlack(botToken, "chat.postMessage", {
        channel,
        thread_ts: threadTs,
        text,
      });
    },

    async postDirectMessage({ userId, text }) {
      await callSlack(botToken, "chat.postMessage", { channel: userId, text });
    },

    async addReaction({ channel, ts, name }) {
      try {
        await callSlack(botToken, "reactions.add", {
          channel,
          timestamp: ts,
          name,
        });
      } catch (error) {
        // The reaction is already where it should be; a task reaching a final
        // column twice, or a Slack redelivery, is not a failure.
        if (
          error instanceof Error &&
          error.message.includes("already_reacted")
        ) {
          return;
        }

        throw error;
      }
    },
  };
}

export async function replyQuietly(
  client: SlackClient,
  params: { channel: string; threadTs: string; text: string },
): Promise<void> {
  try {
    await client.postThreadReply(params);
  } catch (error) {
    // The task exists either way; a channel the bot was removed from must not
    // turn into a retried delivery and a duplicate task.
    console.error("[Slack App] Failed to reply in thread:", error);
  }
}

export async function directMessageQuietly(
  client: SlackClient,
  params: { userId: string; text: string },
): Promise<void> {
  try {
    await client.postDirectMessage(params);
  } catch (error) {
    // Someone who left, or blocked the app, must not undo the work being
    // reported; the issue and the pull request carry the same news.
    console.error("[Slack App] Failed to send a direct message:", error);
  }
}
