import type { SlackReactionAdded } from "./reaction-added";
import { verifySlackSignature } from "./signature";

export type SlackEventsRequest = {
  body: string;
  timestamp: string;
  signature: string;
  /**
   * Slack's `X-Slack-Retry-Num`, present only on redeliveries. A retry is
   * handled like any other delivery: Slack also retries requests that never
   * arrived, so dropping them loses reactions outright. The unique index on the
   * Slack message external link is what stops a redelivery filing twice.
   */
  retryNum: string | null;
};

export type SlackEventsResult = {
  status: number;
  body: string | Record<string, unknown>;
  /** Resolves once the reaction has been processed; never rejects. */
  work?: Promise<void>;
};

type SlackEventEnvelope = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    reaction?: string;
    user?: string;
    item?: { type?: string; channel?: string; ts?: string };
    event_ts?: string;
  };
};

export async function handleSlackEventsRequest(
  request: SlackEventsRequest,
  {
    signingSecret,
    now,
    dispatch,
  }: {
    signingSecret: string;
    now?: Date;
    dispatch: (event: SlackReactionAdded) => Promise<void>;
  },
): Promise<SlackEventsResult> {
  if (
    !verifySlackSignature({
      body: request.body,
      timestamp: request.timestamp,
      signature: request.signature,
      signingSecret,
      now,
    })
  ) {
    return { status: 401, body: "invalid signature" };
  }

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(request.body) as SlackEventEnvelope;
  } catch {
    return { status: 400, body: "invalid payload" };
  }

  if (payload.type === "url_verification") {
    return { status: 200, body: { challenge: payload.challenge ?? "" } };
  }

  const event = payload.event;

  if (
    payload.type !== "event_callback" ||
    event?.type !== "reaction_added" ||
    !event.reaction ||
    !event.user ||
    !event.item?.channel ||
    !event.item?.ts
  ) {
    return { status: 200, body: "ok" };
  }

  const reaction: SlackReactionAdded = {
    reaction: event.reaction,
    userId: event.user,
    itemType: event.item.type ?? "message",
    channel: event.item.channel,
    ts: event.item.ts,
    ...(event.event_ts ? { eventTs: event.event_ts } : {}),
  };

  // Slack expects an acknowledgement within three seconds, so the work is
  // handed back to the caller rather than awaited here.
  const work = dispatch(reaction).catch((error) => {
    console.error("[Slack App] Failed to handle reaction:", error);
  });

  return { status: 200, body: "ok", work };
}
