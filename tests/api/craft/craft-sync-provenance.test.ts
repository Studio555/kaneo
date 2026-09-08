import { describe, expect, it } from "vitest";
import {
  addPendingCraftLabelOps,
  CRAFT_PENDING_OP_TTL_MS,
  type CraftSyncMetadata,
  expectedCraftLabelOps,
  isInboundCraftEcho,
  isOutboundCraftEcho,
  matchPendingCraftLabelOp,
  parseLinkMetadata,
  recordCraftSync,
} from "../../../apps/api/src/plugins/craft-sync-provenance";

const NOW = Date.parse("2026-09-08T20:38:30.000Z");

function metadataWith(
  source: "kaneo" | "github" | "gitea",
  value: string | null,
  agoMs: number,
): CraftSyncMetadata {
  return {
    lastSync: {
      craft: {
        timestamp: new Date(NOW - agoMs).toISOString(),
        source,
        value,
      },
    },
  };
}

describe("parseLinkMetadata", () => {
  it("returns an empty object for a link that has no metadata yet", () => {
    expect(parseLinkMetadata(null)).toEqual({});
    expect(parseLinkMetadata(undefined)).toEqual({});
  });

  it("returns an empty object rather than throwing on unparseable metadata", () => {
    expect(parseLinkMetadata("{not json")).toEqual({});
  });

  it("parses a stored metadata document", () => {
    expect(parseLinkMetadata('{"state":"open"}')).toEqual({ state: "open" });
  });
});

describe("recordCraftSync", () => {
  it("stamps the craft record without disturbing neighbouring sync records", () => {
    const metadata: CraftSyncMetadata = {
      state: "open",
      lastSync: {
        title: { timestamp: "2026-09-08T13:58:40.963Z", source: "kaneo" },
      },
    };

    const next = recordCraftSync(
      metadata,
      { source: "github", value: "AI" },
      NOW,
    );

    expect(next).toEqual({
      state: "open",
      lastSync: {
        title: { timestamp: "2026-09-08T13:58:40.963Z", source: "kaneo" },
        craft: {
          timestamp: new Date(NOW).toISOString(),
          source: "github",
          value: "AI",
        },
      },
    });
    // The caller's document is left alone.
    expect(metadata.lastSync?.craft).toBeUndefined();
  });

  it("records a cleared craft as a null value, not a missing one", () => {
    const next = recordCraftSync({}, { source: "kaneo", value: null }, NOW);

    expect(next.lastSync?.craft).toMatchObject({
      source: "kaneo",
      value: null,
    });
  });
});

describe("expectedCraftLabelOps", () => {
  it("describes both halves of a craft change", () => {
    expect(expectedCraftLabelOps("AI", "Engineering")).toEqual([
      { label: "craft:AI", op: "removed" },
      { label: "craft:Engineering", op: "added" },
    ]);
  });

  it("describes setting a craft on a task that had none", () => {
    expect(expectedCraftLabelOps(null, "AI")).toEqual([
      { label: "craft:AI", op: "added" },
    ]);
  });

  it("describes clearing a craft", () => {
    expect(expectedCraftLabelOps("AI", null)).toEqual([
      { label: "craft:AI", op: "removed" },
    ]);
  });

  it("describes nothing when neither side has a craft", () => {
    expect(expectedCraftLabelOps(null, null)).toEqual([]);
  });
});

describe("addPendingCraftLabelOps", () => {
  it("stores the operations we are about to perform", () => {
    const next = addPendingCraftLabelOps(
      { state: "open" },
      expectedCraftLabelOps(null, "AI"),
      NOW,
    );

    expect(next).toEqual({
      state: "open",
      pendingCraftLabelOps: [
        { label: "craft:AI", op: "added", at: new Date(NOW).toISOString() },
      ],
    });
  });

  it("keeps operations from an earlier change that has not echoed back yet", () => {
    // Two craft changes in quick succession leave two label mutations in
    // flight; both echoes still have to be recognized.
    const first = addPendingCraftLabelOps(
      {},
      expectedCraftLabelOps(null, "AI"),
      NOW - 1_000,
    );

    const second = addPendingCraftLabelOps(
      first,
      expectedCraftLabelOps("AI", null),
      NOW,
    );

    expect(second.pendingCraftLabelOps).toEqual([
      {
        label: "craft:AI",
        op: "added",
        at: new Date(NOW - 1_000).toISOString(),
      },
      { label: "craft:AI", op: "removed", at: new Date(NOW).toISOString() },
    ]);
  });

  it("prunes operations whose echo never arrived", () => {
    const stale = addPendingCraftLabelOps(
      {},
      expectedCraftLabelOps(null, "Design"),
      NOW - CRAFT_PENDING_OP_TTL_MS - 1,
    );

    const next = addPendingCraftLabelOps(
      stale,
      expectedCraftLabelOps(null, "AI"),
      NOW,
    );

    expect(next.pendingCraftLabelOps).toEqual([
      { label: "craft:AI", op: "added", at: new Date(NOW).toISOString() },
    ]);
  });

  it("leaves the document untouched when there is nothing to record", () => {
    const metadata = { state: "open" };

    expect(addPendingCraftLabelOps(metadata, [], NOW)).toEqual(metadata);
  });
});

describe("matchPendingCraftLabelOp", () => {
  const pending = addPendingCraftLabelOps(
    { state: "open" },
    expectedCraftLabelOps("AI", "Engineering"),
    NOW - 900,
  );

  it("recognizes the echo of an operation we performed", () => {
    const result = matchPendingCraftLabelOp(
      pending,
      { label: "craft:AI", op: "removed" },
      NOW,
    );

    expect(result.matched).toBe(true);
  });

  it("consumes the matched operation so a later real change is not swallowed", () => {
    const first = matchPendingCraftLabelOp(
      pending,
      { label: "craft:AI", op: "removed" },
      NOW,
    );

    expect(first.metadata.pendingCraftLabelOps).toEqual([
      {
        label: "craft:Engineering",
        op: "added",
        at: new Date(NOW - 900).toISOString(),
      },
    ]);

    const second = matchPendingCraftLabelOp(
      first.metadata,
      { label: "craft:AI", op: "removed" },
      NOW,
    );

    expect(second.matched).toBe(false);
  });

  it("does not match a label we never touched", () => {
    // The finding this replaces: a forge user swapping in a different craft
    // moments after a Kaneo change must not be mistaken for our own echo.
    const result = matchPendingCraftLabelOp(
      pending,
      { label: "craft:Design", op: "added" },
      NOW,
    );

    expect(result.matched).toBe(false);
  });

  it("does not match the opposite operation on the same label", () => {
    const result = matchPendingCraftLabelOp(
      pending,
      { label: "craft:Engineering", op: "removed" },
      NOW,
    );

    expect(result.matched).toBe(false);
  });

  it("does not match an operation whose echo window has passed", () => {
    const result = matchPendingCraftLabelOp(
      pending,
      { label: "craft:AI", op: "removed" },
      NOW + CRAFT_PENDING_OP_TTL_MS,
    );

    expect(result.matched).toBe(false);
  });

  it("matches nothing when no operations are pending", () => {
    const result = matchPendingCraftLabelOp(
      { state: "open" },
      { label: "craft:AI", op: "added" },
      NOW,
    );

    expect(result.matched).toBe(false);
    expect(result.metadata).toEqual({ state: "open" });
  });
});

describe("isInboundCraftEcho", () => {
  it("is not an echo when the link has never synced a craft", () => {
    expect(isInboundCraftEcho({}, "AI")).toBe(false);
  });

  it("is an echo when the forge reports back the craft Kaneo last pushed", () => {
    expect(isInboundCraftEcho(metadataWith("kaneo", "AI", 900), "AI")).toBe(
      true,
    );
  });

  it("is not an echo merely because Kaneo wrote something recently", () => {
    // Time alone no longer decides this; the pending-operation ledger does.
    expect(isInboundCraftEcho(metadataWith("kaneo", null, 900), "AI")).toBe(
      false,
    );
  });

  it("never suppresses a change that follows another forge change", () => {
    expect(
      isInboundCraftEcho(metadataWith("github", "AI", 200), "Engineering"),
    ).toBe(false);
  });
});

describe("isOutboundCraftEcho", () => {
  it("skips pushing a craft the forge itself just reported", () => {
    expect(isOutboundCraftEcho(metadataWith("github", "AI", 900), "AI")).toBe(
      true,
    );
  });

  it("pushes a craft the forge does not have yet", () => {
    expect(
      isOutboundCraftEcho(metadataWith("github", "AI", 900), "Engineering"),
    ).toBe(false);
  });

  it("does not treat Kaneo's own last write as a reason to skip", () => {
    // Two people editing in Kaneo must both reach the forge; only a forge
    // origin means the label is already in place.
    expect(isOutboundCraftEcho(metadataWith("kaneo", "AI", 900), "AI")).toBe(
      false,
    );
  });

  it("pushes when the link has never synced a craft", () => {
    expect(isOutboundCraftEcho({}, "AI")).toBe(false);
  });
});
