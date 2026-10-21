import { describe, expect, it } from "vite-plus/test";
import { orderBacklogSections } from "../../../apps/api/src/column/backlog-sections";

describe("orderBacklogSections", () => {
  it("pins planned first and archived last, whatever their positions", () => {
    const sections = [
      { slug: "archived", position: 0, systemKey: "archived" as const },
      { slug: "later", position: 5, systemKey: null },
      { slug: "planned", position: 9, systemKey: "planned" as const },
      { slug: "icebox", position: 2, systemKey: null },
    ];

    expect(orderBacklogSections(sections).map((s) => s.slug)).toEqual([
      "planned",
      "icebox",
      "later",
      "archived",
    ]);
  });
});
