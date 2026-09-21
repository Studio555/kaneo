import { describe, expect, it } from "vitest";
import {
  deriveTaskTitle,
  formatTaskDescription,
} from "../../../../apps/api/src/plugins/slack-app/format";

describe("deriveTaskTitle", () => {
  it("uses the first line of the message", () => {
    expect(deriveTaskTitle("Fix the login bug\nIt happens on iOS only")).toBe(
      "Fix the login bug",
    );
  });

  it("skips leading blank lines", () => {
    expect(deriveTaskTitle("\n\n  Ship the release notes")).toBe(
      "Ship the release notes",
    );
  });

  it("collapses runs of whitespace so the title stays on one line", () => {
    expect(deriveTaskTitle("Fix    the\tlogin   bug")).toBe(
      "Fix the login bug",
    );
  });

  it("truncates a long first line to 80 characters including the ellipsis", () => {
    const title = deriveTaskTitle("a".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("keeps a line of exactly 80 characters intact", () => {
    const line = "b".repeat(80);
    expect(deriveTaskTitle(line)).toBe(line);
  });

  it("falls back to a placeholder when the message has no text", () => {
    expect(deriveTaskTitle("")).toBe("Slack message");
    expect(deriveTaskTitle("   \n  ")).toBe("Slack message");
  });
});

describe("formatTaskDescription", () => {
  it("quotes the message and credits the author, channel and permalink", () => {
    const description = formatTaskDescription({
      text: "The checkout screen crashes\nwhen the cart is empty",
      authorName: "Alex",
      channelName: "bugs",
      permalink: "https://studio555.slack.com/archives/C1/p1700000000000100",
    });

    expect(description).toBe(
      [
        "> The checkout screen crashes",
        "> when the cart is empty",
        "",
        "Filed from Slack — posted by Alex in #bugs.",
        "https://studio555.slack.com/archives/C1/p1700000000000100",
      ].join("\n"),
    );
  });

  it("omits the quote block when the message carried no text", () => {
    const description = formatTaskDescription({
      text: "",
      authorName: "Alex",
      channelName: "bugs",
      permalink: "https://studio555.slack.com/archives/C1/p1",
    });

    expect(description).toBe(
      [
        "Filed from Slack — posted by Alex in #bugs.",
        "https://studio555.slack.com/archives/C1/p1",
      ].join("\n"),
    );
  });

  it("names an unknown author rather than leaving a gap", () => {
    const description = formatTaskDescription({
      text: "Something broke",
      authorName: null,
      channelName: "bugs",
      permalink: "https://studio555.slack.com/archives/C1/p1",
    });

    expect(description).toContain("posted by an unknown user in #bugs.");
  });

  it("drops the channel clause when the channel name is unknown", () => {
    const description = formatTaskDescription({
      text: "Something broke",
      authorName: "Alex",
      channelName: null,
      permalink: "https://studio555.slack.com/archives/C1/p1",
    });

    expect(description).toContain("Filed from Slack — posted by Alex.");
  });
});
