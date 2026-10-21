/**
 * Provenance for the craft <-> forge-label sync.
 *
 * Craft is synced in both directions through a `craft:` issue label, so every
 * write on one side produces a webhook back to the other. The unchanged-value
 * early return in `updateTaskCraft` only breaks that cycle while the echo
 * still matches the value that produced it; two craft changes in quick
 * succession put two label mutations in flight at once, so each echo lands
 * after the task has moved on and reads as a genuine change. Each applied
 * echo emits a fresh outbound label write, which produces a fresh webhook,
 * and the task flips between the two values indefinitely.
 *
 * Rather than suppress everything that arrives shortly after one of our own
 * writes -- which would swallow a person relabelling the issue in that same
 * moment -- the outbound side records the exact label operations it is about
 * to perform, and the inbound side consumes them one for one. An operation
 * nobody claims is somebody's real edit.
 */

import { toCraftLabelName } from "./system-labels";

export type CraftSyncSource = "kaneo" | "github" | "gitea";

export type CraftSyncRecord = {
  timestamp: string;
  source: CraftSyncSource;
  /** Craft name, or null for "no craft". */
  value: string | null;
};

export type CraftLabelOpKind = "added" | "removed";

/** One label mutation we performed and therefore expect to hear back about. */
export type CraftLabelOp = {
  label: string;
  op: CraftLabelOpKind;
  at: string;
};

export type CraftSyncMetadata = {
  lastSync?: {
    craft?: CraftSyncRecord;
    [key: string]: unknown;
  };
  pendingCraftLabelOps?: CraftLabelOp[];
  [key: string]: unknown;
};

/**
 * How long an unclaimed operation stays on the ledger. It only has to outlast
 * webhook delivery (the observed loop cycled about once a second); past that
 * the echo is assumed lost, and leaving the entry would make it swallow a
 * later genuine change to the same label.
 */
export const CRAFT_PENDING_OP_TTL_MS = 5 * 60_000;

export function parseLinkMetadata(
  raw: string | null | undefined,
): CraftSyncMetadata {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as CraftSyncMetadata)
      : {};
  } catch {
    // Metadata is a convenience cache, never the source of truth, so a
    // corrupt document must not take the webhook down with it.
    return {};
  }
}

export function recordCraftSync(
  metadata: CraftSyncMetadata,
  record: { source: CraftSyncSource; value: string | null },
  now: number = Date.now(),
): CraftSyncMetadata {
  return {
    ...metadata,
    lastSync: {
      ...metadata.lastSync,
      craft: {
        timestamp: new Date(now).toISOString(),
        source: record.source,
        value: record.value,
      },
    },
  };
}

/**
 * The label mutations a craft change implies, in the order the forge handlers
 * perform them.
 */
export function expectedCraftLabelOps(
  oldCraftName: string | null,
  newCraftName: string | null,
): Array<{ label: string; op: CraftLabelOpKind }> {
  const ops: Array<{ label: string; op: CraftLabelOpKind }> = [];

  if (oldCraftName) {
    ops.push({ label: toCraftLabelName(oldCraftName), op: "removed" });
  }
  if (newCraftName) {
    ops.push({ label: toCraftLabelName(newCraftName), op: "added" });
  }

  return ops;
}

export function addPendingCraftLabelOps(
  metadata: CraftSyncMetadata,
  ops: Array<{ label: string; op: CraftLabelOpKind }>,
  now: number = Date.now(),
): CraftSyncMetadata {
  if (ops.length === 0) return metadata;

  const at = new Date(now).toISOString();

  return {
    ...metadata,
    pendingCraftLabelOps: [
      ...livePendingOps(metadata, now),
      ...ops.map((op) => ({ ...op, at })),
    ],
  };
}

/**
 * Claim an inbound label event as the echo of one of our own operations,
 * returning the metadata with that operation consumed.
 *
 * Consuming matters: the same label can legitimately be added, removed and
 * added again, and a ledger entry left in place would swallow the next one.
 */
export function matchPendingCraftLabelOp(
  metadata: CraftSyncMetadata,
  incoming: { label: string; op: CraftLabelOpKind },
  now: number = Date.now(),
): { matched: boolean; metadata: CraftSyncMetadata } {
  const live = livePendingOps(metadata, now);
  const index = live.findIndex(
    (op) => op.label === incoming.label && op.op === incoming.op,
  );

  if (index === -1) {
    return { matched: false, metadata };
  }

  const remaining = live.filter((_, i) => i !== index);

  return {
    matched: true,
    metadata: { ...metadata, pendingCraftLabelOps: remaining },
  };
}

/**
 * Is the forge simply restating the craft we last pushed to it? Cheap
 * redundancy check for the paths that report a whole label set and so carry
 * no single operation to claim.
 */
export function isInboundCraftEcho(
  metadata: CraftSyncMetadata,
  incomingValue: string | null,
): boolean {
  const last = metadata.lastSync?.craft;
  if (last?.source !== "kaneo") return false;

  return last.value === incomingValue;
}

/**
 * Should an outbound label write be skipped because the forge is where this
 * craft came from and already carries it?
 */
export function isOutboundCraftEcho(
  metadata: CraftSyncMetadata,
  outgoingValue: string | null,
): boolean {
  const last = metadata.lastSync?.craft;
  if (!last || last.source === "kaneo") return false;

  return last.value === outgoingValue;
}

function livePendingOps(
  metadata: CraftSyncMetadata,
  now: number,
): CraftLabelOp[] {
  const pending = metadata.pendingCraftLabelOps;
  if (!Array.isArray(pending)) return [];

  return pending.filter((op) => {
    const at = Date.parse(op.at);
    return !Number.isNaN(at) && now - at < CRAFT_PENDING_OP_TTL_MS;
  });
}
