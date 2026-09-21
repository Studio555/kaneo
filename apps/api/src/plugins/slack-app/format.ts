const MAX_TITLE_LENGTH = 80;
const TITLE_FALLBACK = "Slack message";

/**
 * A Slack message is free-form prose; a task title is one line. Take the first
 * line that has content and keep it short enough to read on a board card.
 */
export function deriveTaskTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return TITLE_FALLBACK;
  }

  if (firstLine.length <= MAX_TITLE_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function formatTaskDescription({
  text,
  authorName,
  channelName,
  permalink,
}: {
  text: string;
  authorName: string | null;
  channelName: string | null;
  permalink: string;
}): string {
  const author = authorName ?? "an unknown user";
  const origin = channelName
    ? `Filed from Slack — posted by ${author} in #${channelName}.`
    : `Filed from Slack — posted by ${author}.`;

  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

  return text.trim()
    ? [quoted, "", origin, permalink].join("\n")
    : [origin, permalink].join("\n");
}
