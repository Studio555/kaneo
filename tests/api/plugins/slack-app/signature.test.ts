import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../../../../apps/api/src/plugins/slack-app/signature";

const SIGNING_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

function sign(body: string, timestamp: string, secret = SIGNING_SECRET) {
  return `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const body = '{"type":"event_callback"}';
  const timestamp = "1700000000";
  const now = new Date(1_700_000_010_000);

  it("accepts a signature produced with the signing secret", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: sign(body, timestamp),
        signingSecret: SIGNING_SECRET,
        now,
      }),
    ).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: sign(body, timestamp, "someone-elses-secret"),
        signingSecret: SIGNING_SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a signature that covers a different body", () => {
    expect(
      verifySlackSignature({
        body: '{"type":"event_callback","tampered":true}',
        timestamp,
        signature: sign(body, timestamp),
        signingSecret: SIGNING_SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a replay older than five minutes", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: sign(body, timestamp),
        signingSecret: SIGNING_SECRET,
        now: new Date(1_700_000_000_000 + 301_000),
      }),
    ).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: sign(body, timestamp),
        signingSecret: SIGNING_SECRET,
        now: new Date(1_700_000_000_000 - 301_000),
      }),
    ).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp: "not-a-timestamp",
        signature: sign(body, "not-a-timestamp"),
        signingSecret: SIGNING_SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("rejects a malformed signature without crashing", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: "v0=short",
        signingSecret: SIGNING_SECRET,
        now,
      }),
    ).toBe(false);
  });

  it("rejects an empty signing secret", () => {
    expect(
      verifySlackSignature({
        body,
        timestamp,
        signature: sign(body, timestamp, ""),
        signingSecret: "",
        now,
      }),
    ).toBe(false);
  });
});
