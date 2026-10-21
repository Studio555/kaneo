import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { handleSlackEventsRequest } from "../../../../apps/api/src/plugins/slack-app/events-request";

const SIGNING_SECRET = "signing-secret";
const TIMESTAMP = "1700000000";
const NOW = new Date(1_700_000_005_000);

function sign(body: string) {
  return `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${TIMESTAMP}:${body}`)
    .digest("hex")}`;
}

function request(payload: unknown, overrides: Record<string, unknown> = {}) {
  const body = JSON.stringify(payload);
  return {
    body,
    timestamp: TIMESTAMP,
    signature: sign(body),
    retryNum: null,
    ...overrides,
  };
}

const reactionAdded = {
  type: "event_callback",
  event: {
    type: "reaction_added",
    reaction: "kaneo",
    user: "UREACTOR",
    item: { type: "message", channel: "C1", ts: "1700000000.000100" },
  },
};

describe("handleSlackEventsRequest", () => {
  it("answers Slack's URL verification challenge", async () => {
    const dispatch = vi.fn();

    const result = await handleSlackEventsRequest(
      request({ type: "url_verification", challenge: "abc123" }),
      { signingSecret: SIGNING_SECRET, now: NOW, dispatch },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ challenge: "abc123" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a request whose signature does not verify", async () => {
    const dispatch = vi.fn();

    const result = await handleSlackEventsRequest(
      request(reactionAdded, { signature: "v0=deadbeef" }),
      { signingSecret: SIGNING_SECRET, now: NOW, dispatch },
    );

    expect(result.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("hands a reaction to the dispatcher in Kaneo's own shape", async () => {
    const dispatch = vi.fn(async () => undefined);

    const result = await handleSlackEventsRequest(request(reactionAdded), {
      signingSecret: SIGNING_SECRET,
      now: NOW,
      dispatch,
    });
    await result.work;

    expect(result.status).toBe(200);
    expect(dispatch).toHaveBeenCalledWith({
      reaction: "kaneo",
      userId: "UREACTOR",
      itemType: "message",
      channel: "C1",
      ts: "1700000000.000100",
    });
  });

  it("acknowledges before the dispatched work finishes", async () => {
    let settled = false;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled = true;
            resolve();
          }, 10);
        }),
    );

    const result = await handleSlackEventsRequest(request(reactionAdded), {
      signingSecret: SIGNING_SECRET,
      now: NOW,
      dispatch,
    });

    expect(result.status).toBe(200);
    expect(settled).toBe(false);

    await result.work;
    expect(settled).toBe(true);
  });

  // Slack retries a delivery that never arrived, not only one it acknowledged
  // late, so discarding retries drops events outright. The unique index on the
  // Slack message link is what keeps a redelivery from filing a second task.
  it("processes a retried delivery, because the first one may never have landed", async () => {
    const dispatch = vi.fn(async () => undefined);

    const result = await handleSlackEventsRequest(
      request(reactionAdded, { retryNum: "1" }),
      { signingSecret: SIGNING_SECRET, now: NOW, dispatch },
    );
    await result.work;

    expect(result.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("ignores event types it does not handle", async () => {
    const dispatch = vi.fn();

    const result = await handleSlackEventsRequest(
      request({
        type: "event_callback",
        event: { type: "message", channel: "C1" },
      }),
      { signingSecret: SIGNING_SECRET, now: NOW, dispatch },
    );

    expect(result.status).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const dispatch = vi.fn();
    const body = "not json";

    const result = await handleSlackEventsRequest(
      { body, timestamp: TIMESTAMP, signature: sign(body), retryNum: null },
      { signingSecret: SIGNING_SECRET, now: NOW, dispatch },
    );

    expect(result.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses every request when no signing secret is configured", async () => {
    const dispatch = vi.fn();

    const result = await handleSlackEventsRequest(request(reactionAdded), {
      signingSecret: "",
      now: NOW,
      dispatch,
    });

    expect(result.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not let a dispatch failure reject the returned work", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("database is down");
    });

    const result = await handleSlackEventsRequest(request(reactionAdded), {
      signingSecret: SIGNING_SECRET,
      now: NOW,
      dispatch,
    });

    await expect(result.work).resolves.toBeUndefined();
  });
});
