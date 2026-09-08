import { describe, expect, it } from "vitest";
import {
  OUTBOUND_STATE_ECHO_WINDOW_MS,
  shouldSkipInboundAssigneeSync,
} from "../../../../../apps/api/src/plugins/github/utils/outbound-echo";

const now = Date.UTC(2026, 8, 8, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("shouldSkipInboundAssigneeSync", () => {
  it("applies the event when Kaneo has never written an assignee", () => {
    expect(
      shouldSkipInboundAssigneeSync({}, { updated_at: iso(now) }, "ada"),
    ).toBe(false);
  });

  it("drops a delivery older than our own last write", () => {
    // GitHub retries deliveries, so an event describing assignee state we have
    // already moved past is a straggler whatever login it carries.
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: "ada" },
        { updated_at: iso(now - OUTBOUND_STATE_ECHO_WINDOW_MS - 1) },
        "grace",
      ),
    ).toBe(true);
  });

  it("drops the echo of the assignee we just wrote", () => {
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: "ada" },
        { updated_at: iso(now + 500) },
        "ada",
      ),
    ).toBe(true);
  });

  it("applies a different assignee landing inside the echo window", () => {
    // Somebody reassigning on GitHub seconds after Kaneo wrote is a real
    // action, not our update returning.
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: "ada" },
        { updated_at: iso(now + 500) },
        "grace",
      ),
    ).toBe(false);
  });

  it("drops the echo of an unassign we just wrote", () => {
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: null },
        { updated_at: iso(now + 500) },
        null,
      ),
    ).toBe(true);
  });

  it("drops the echo when GitHub echoes our login in a different case", () => {
    // GitHub logins are case-insensitive, and the webhook payload does not
    // promise the same casing we stored, so a literal compare would treat our
    // own write as somebody else reassigning.
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: "ada" },
        { updated_at: iso(now + 500) },
        "Ada",
      ),
    ).toBe(true);
  });

  it("applies the event when the issue carries no usable timestamp", () => {
    expect(
      shouldSkipInboundAssigneeSync(
        { lastOutboundAssigneeSyncAt: now, assigneeLogin: "ada" },
        { updated_at: "not-a-date" },
        "ada",
      ),
    ).toBe(false);
  });
});
