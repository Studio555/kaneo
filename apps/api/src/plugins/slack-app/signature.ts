import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack signs every request with the app's signing secret. The timestamp is
 * part of the signed string, so an attacker cannot replay an old body under a
 * fresh timestamp; rejecting stale timestamps closes the other direction, where
 * a captured request is replayed verbatim.
 */
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export function verifySlackSignature({
  body,
  timestamp,
  signature,
  signingSecret,
  now = new Date(),
}: {
  body: string;
  timestamp: string;
  signature: string;
  signingSecret: string;
  now?: Date;
}): boolean {
  if (!signingSecret || !signature || !timestamp) {
    return false;
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return false;
  }

  const skewSeconds = Math.abs(now.getTime() / 1000 - sentAt);
  if (skewSeconds > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
