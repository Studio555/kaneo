import { describe, expect, it } from "vitest";
import {
  getLinkRepository,
  getLinkRepositoryName,
} from "./external-link-repository";

describe("getLinkRepository", () => {
  it("prefers the repository recorded in the link metadata", () => {
    expect(
      getLinkRepository({
        url: "https://github.com/Studio555/s555-atlas/pull/7",
        metadata: { repository: "Studio555/showrooms-server" },
      }),
    ).toBe("Studio555/showrooms-server");
  });

  it("falls back to the GitHub pull request URL for links written before the repository was recorded", () => {
    expect(
      getLinkRepository({
        url: "https://github.com/Studio555/s555-atlas/pull/7",
        metadata: { state: "open" },
      }),
    ).toBe("Studio555/s555-atlas");
  });

  it("returns null when neither source names a repository", () => {
    expect(
      getLinkRepository({
        url: "https://git.example.com/x/y/pulls/1",
        metadata: null,
      }),
    ).toBeNull();
  });
});

describe("getLinkRepositoryName", () => {
  it("returns the repository without its owner", () => {
    expect(
      getLinkRepositoryName({
        url: "",
        metadata: { repository: "Studio555/showrooms-server" },
      }),
    ).toBe("showrooms-server");
  });

  it("returns null when the repository is unknown", () => {
    expect(getLinkRepositoryName({ url: "", metadata: null })).toBeNull();
  });
});
