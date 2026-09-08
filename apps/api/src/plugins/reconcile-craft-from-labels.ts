import { eq } from "drizzle-orm";
import db from "../database";
import { taskTable } from "../database/schema";
import updateTaskCraft from "../task/controllers/update-task-craft";
import {
  type CraftLabelOpKind,
  type CraftSyncSource,
  isInboundCraftEcho,
  matchPendingCraftLabelOp,
  parseLinkMetadata,
  recordCraftSync,
} from "./craft-sync-provenance";
import { updateExternalLink } from "./github/services/link-manager";
import { findCraftLabelName, resolveCraftByName } from "./resolve-craft-label";
import { parseCraftLabelName } from "./system-labels";

export type CraftReconcileResult =
  | "applied"
  | "unchanged"
  | "echo"
  | "unknown-craft";

type ReconcileArgs = {
  taskId: string;
  workspaceId: string;
  /** The issue's complete label set, as the webhook payload reported it. */
  labels: Array<string | { name?: string }> | undefined;
  /**
   * The single label this event changed, when the forge reports one. Absent
   * for whole-set notifications such as Gitea's `label_updated`.
   */
  delta?: { label: string; op: CraftLabelOpKind };
  link: { id: string; metadata: string | null };
  source: Exclude<CraftSyncSource, "kaneo">;
  now?: number;
};

/**
 * Bring a task's craft in line with the `craft:` label on its forge issue.
 *
 * A label the event just added is authoritative: craft is single-select, but
 * an issue can still end up carrying two `craft:` labels, and reading the set
 * alone would resolve whichever happened to come first and quietly ignore
 * what the person chose. Everything else falls back to the set, which is the
 * forge's own account of where the issue stands.
 *
 * An unrecognized craft name leaves the craft alone: the vocabulary is
 * curated in Kaneo, not seeded from the forge.
 */
export async function reconcileCraftFromIssueLabels({
  taskId,
  workspaceId,
  labels,
  delta,
  link,
  source,
  now = Date.now(),
}: ReconcileArgs): Promise<CraftReconcileResult> {
  let metadata = parseLinkMetadata(link.metadata);

  if (delta) {
    const claim = matchPendingCraftLabelOp(metadata, delta, now);

    if (claim.matched) {
      // Persisted so the operation cannot be claimed twice: the same label
      // may legitimately be added, removed and added again.
      await updateExternalLink(link.id, { metadata: claim.metadata });
      return "echo";
    }

    metadata = claim.metadata;
  }

  const craftLabelName =
    (delta?.op === "added" ? parseCraftLabelName(delta.label) : null) ??
    findCraftLabelName(labels);

  let craftId: string | null = null;
  let craftName: string | null = null;

  if (craftLabelName) {
    const craft = await resolveCraftByName(workspaceId, craftLabelName);
    if (!craft) {
      return "unknown-craft";
    }
    craftId = craft.id;
    craftName = craft.name;
  }

  if (isInboundCraftEcho(metadata, craftName)) {
    return "echo";
  }

  const task = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if ((task?.craftId ?? null) === craftId) {
    return "unchanged";
  }

  // Recorded before the change is applied, not after: updateTaskCraft
  // publishes task.craft_changed, and the plugin handler for that event reads
  // this metadata to decide whether the forge already carries the label. The
  // event bus dispatches synchronously without awaiting handlers, so writing
  // the record afterwards would race that read and push the label back out.
  await updateExternalLink(link.id, {
    metadata: recordCraftSync(metadata, { source, value: craftName }, now),
  });

  await updateTaskCraft({ id: taskId, craftId, currentUserId: null });

  return "applied";
}
