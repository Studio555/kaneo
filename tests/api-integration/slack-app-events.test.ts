import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";

const SIGNING_SECRET = "integration-signing-secret";

function post(body: string, headers: Record<string, string>) {
  const { app } = createApp();

  return app.request("/api/slack-app/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function signedHeaders(body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", SIGNING_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`,
  };
}

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-integration";
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
});

afterEach(() => {
  process.env.SLACK_BOT_TOKEN = "";
  process.env.SLACK_SIGNING_SECRET = "";
});

describe("API integration: Slack app events", () => {
  it("answers the URL verification challenge without a Kaneo session", async () => {
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "challenge-token",
    });

    const response = await post(body, signedHeaders(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-token",
    });
  });

  it("refuses an unsigned request rather than falling through to the API auth error", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });

    const response = await post(body, {});

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("invalid signature");
  });

  it("refuses a request signed with the wrong secret", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await post(body, {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${createHmac("sha256", "wrong-secret")
        .update(`v0:${timestamp}:${body}`)
        .digest("hex")}`,
    });

    expect(response.status).toBe(401);
    // The API's own auth middleware also answers 401, so the body is what proves
    // the rejection came from the signature check.
    await expect(response.text()).resolves.toBe("invalid signature");
  });

  it("acknowledges a reaction for a workspace with no integration configured", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "reaction_added",
        reaction: "kaneo",
        user: "UREACTOR",
        item: { type: "message", channel: "C1", ts: "1700000000.000100" },
      },
    });

    const response = await post(body, signedHeaders(body));

    expect(response.status).toBe(200);
  });

  it("reports itself unconfigured when the instance has no Slack credentials", async () => {
    process.env.SLACK_BOT_TOKEN = "";
    process.env.SLACK_SIGNING_SECRET = "";

    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const response = await post(body, signedHeaders(body));

    expect(response.status).toBe(503);
  });
});
