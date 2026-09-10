import { describe, expect, it } from "vitest";
import {
  extractIssueReferences,
  extractIssueReferencesFromPullRequest,
} from "../../../../../apps/api/src/plugins/github/utils/issue-reference";

const OWNER = "Studio555";
const REPO = "s555-atlas";

describe("extractIssueReferences", () => {
  it("matches the owner/repo#number short form", () => {
    expect(
      extractIssueReferences("Closes Studio555/s555-atlas#12", OWNER, REPO),
    ).toEqual([12]);
  });

  it("matches owner and repo case-insensitively", () => {
    expect(
      extractIssueReferences("fixes studio555/S555-Atlas#12", OWNER, REPO),
    ).toEqual([12]);
  });

  it("matches the issue URL with scheme, without scheme, and with www", () => {
    expect(
      extractIssueReferences(
        [
          "https://github.com/Studio555/s555-atlas/issues/1",
          "github.com/Studio555/s555-atlas/issues/2",
          "http://www.github.com/Studio555/s555-atlas/issues/3",
        ].join("\n"),
        OWNER,
        REPO,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("ignores pull request URLs", () => {
    expect(
      extractIssueReferences(
        "See https://github.com/Studio555/s555-atlas/pull/12",
        OWNER,
        REPO,
      ),
    ).toEqual([]);
  });

  it("ignores a URL fragment that only looks like a short reference", () => {
    expect(
      extractIssueReferences(
        "https://github.com/Studio555/s555-atlas#12",
        OWNER,
        REPO,
      ),
    ).toEqual([]);
  });

  it("ignores references to other owners or repositories", () => {
    expect(
      extractIssueReferences(
        [
          "Other/s555-atlas#1",
          "Studio555/s555-atlas-web#2",
          "xStudio555/s555-atlas#3",
          "Studio555/s555-atlas.git#4",
        ].join(" "),
        OWNER,
        REPO,
      ),
    ).toEqual([]);
  });

  it("ignores bare #number and GH-number references", () => {
    expect(extractIssueReferences("Closes #12 and GH-13", OWNER, REPO)).toEqual(
      [],
    );
  });

  it("accepts trailing punctuation after the number", () => {
    expect(
      extractIssueReferences(
        "Studio555/s555-atlas#1. (Studio555/s555-atlas#2), Studio555/s555-atlas#3,",
        OWNER,
        REPO,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("normalises leading zeros and drops zero", () => {
    expect(
      extractIssueReferences(
        "Studio555/s555-atlas#012 Studio555/s555-atlas#0",
        OWNER,
        REPO,
      ),
    ).toEqual([12]);
  });

  it("returns nothing for empty or missing text", () => {
    expect(extractIssueReferences("", OWNER, REPO)).toEqual([]);
    expect(extractIssueReferences(null, OWNER, REPO)).toEqual([]);
    expect(extractIssueReferences(undefined, OWNER, REPO)).toEqual([]);
  });

  it("escapes regex characters in the repository name", () => {
    expect(
      extractIssueReferences("Studio555/s555-atlas#1", OWNER, "s555.atlas"),
    ).toEqual([]);
    expect(
      extractIssueReferences("Studio555/s555.atlas#1", OWNER, "s555.atlas"),
    ).toEqual([1]);
  });
});

describe("extractIssueReferencesFromPullRequest", () => {
  it("collects references from branch, title, and body in that order, deduplicated", () => {
    expect(
      extractIssueReferencesFromPullRequest(
        {
          branch: "Studio555/s555-atlas#12-badges",
          title: "Badges (Studio555/s555-atlas#13)",
          body: "Closes Studio555/s555-atlas#12\nRefs https://github.com/Studio555/s555-atlas/issues/14",
        },
        OWNER,
        REPO,
      ),
    ).toEqual([12, 13, 14]);
  });

  it("tolerates a missing body", () => {
    expect(
      extractIssueReferencesFromPullRequest(
        { branch: "arvid/walls", title: "Walls", body: null },
        OWNER,
        REPO,
      ),
    ).toEqual([]);
  });
});
