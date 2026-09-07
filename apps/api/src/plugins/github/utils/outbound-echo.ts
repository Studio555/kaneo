/** Skip webhook sync when it likely echoes our own outbound API update. */
export const OUTBOUND_STATE_ECHO_WINDOW_MS = 5000;

export function parseIssueUpdatedAtMs(issue: {
  updated_at?: string;
}): number | null {
  const raw = issue.updated_at;
  if (!raw || typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

// Closing or reopening an issue from Kaneo comes straight back as a webhook, so
// inbound state sync cannot be driven off the issue's new state alone. The
// origin of the link is the wrong thing to key on — a task Kaneo created is
// exactly the task a person then closes on GitHub, and that close is real.
//
// Two things separate our own writes from a person's. An echo arrives within
// seconds of when we wrote it AND carries the state we wrote; a close landing
// inside the window right after Kaneo *reopened* the issue is somebody acting,
// not our update returning. And because GitHub retries deliveries, an event
// older than our latest write is a straggler describing state we have already
// moved past, whatever state it carries.
//
// Outside those two cases it applies the event. Re-applying an echo is mostly
// harmless because updateTaskStatus reports no change and the handlers only
// publish an event when the status actually moved; dropping a real close leaves
// the board wrong until someone notices, which is the bug this replaced.
export function shouldSkipInboundStateSync(
  metadata: { state?: unknown; lastOutboundStateSyncAt?: unknown },
  issue: { updated_at?: string },
  inboundState: "open" | "closed",
): boolean {
  const lastOutbound = metadata.lastOutboundStateSyncAt;

  if (typeof lastOutbound !== "number" || !Number.isFinite(lastOutbound)) {
    return false;
  }

  const eventMs = parseIssueUpdatedAtMs(issue);
  if (eventMs === null) {
    return false;
  }

  if (eventMs < lastOutbound - OUTBOUND_STATE_ECHO_WINDOW_MS) {
    return true;
  }

  return (
    eventMs <= lastOutbound + OUTBOUND_STATE_ECHO_WINDOW_MS &&
    metadata.state === inboundState
  );
}
