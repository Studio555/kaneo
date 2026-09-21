import * as Sentry from "@sentry/node";

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 10_000;

export type SlackMessage = {
  text: string;
  userId: string | null;
  /** The thread to reply in: the parent thread when there is one, else the message itself. */
  threadTs: string;
};

export type SlackClient = {
  getMessage(params: {
    channel: string;
    ts: string;
  }): Promise<SlackMessage | null>;
  getUserEmail(userId: string): Promise<string | null>;
  getUserName(userId: string): Promise<string | null>;
  getChannelName(channel: string): Promise<string | null>;
  getPermalink(params: { channel: string; ts: string }): Promise<string | null>;
  postThreadReply(params: {
    channel: string;
    threadTs: string;
    text: string;
  }): Promise<void>;
};

/**
 * The Web API answers 200 with `{ ok: false, error }` for application-level
 * failures, so the HTTP status alone never tells you whether a call worked.
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

    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
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
  };
}
