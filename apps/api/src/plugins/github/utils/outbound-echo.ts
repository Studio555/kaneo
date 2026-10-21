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

// The assignee twin of the state check above, and it exists for the same
// reason: assigning from Kaneo comes straight back as issues.assigned, so
// inbound assignee sync cannot be driven off the payload alone.
//
// The two rules carry over unchanged. A delivery older than our latest write
// describes assignee state we have already moved past, whoever it names. A
// delivery inside the window naming the login we just wrote is our own update
// returning, while one naming somebody else is a person reassigning seconds
// after Kaneo wrote — real, and dropping it would leave the board wrong.
//
// `null` on both sides is the unassign case, so it compares as an echo the
// same way a matching login does.
export function shouldSkipInboundAssigneeSync(
  metadata: { assigneeLogin?: unknown; lastOutboundAssigneeSyncAt?: unknown },
  issue: { updated_at?: string },
  inboundLogin: string | null,
): boolean {
  const lastOutbound = metadata.lastOutboundAssigneeSyncAt;

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

  // Logins compare case-insensitively because GitHub treats them that way and
  // the payload does not promise the casing we stored.
  const writtenLogin =
    typeof metadata.assigneeLogin === "string"
      ? metadata.assigneeLogin.toLowerCase()
      : null;

  return (
    eventMs <= lastOutbound + OUTBOUND_STATE_ECHO_WINDOW_MS &&
    writtenLogin === (inboundLogin?.toLowerCase() ?? null)
  );
}
