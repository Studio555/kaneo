import { describe, expect, it } from "vitest";
import { getNextHeaderSort } from "./header-sort";

const manual = { field: "position", direction: "asc" } as const;

describe("getNextHeaderSort", () => {
  it("sorts a new column ascending on first click", () => {
    expect(getNextHeaderSort(manual, "title")).toEqual({
      field: "title",
      direction: "asc",
    });
  });

  it("sorts priority descending on first click so urgent comes first", () => {
    expect(getNextHeaderSort(manual, "priority")).toEqual({
      field: "priority",
      direction: "desc",
    });
  });

  it("flips direction on the second click of the same column", () => {
    expect(
      getNextHeaderSort({ field: "title", direction: "asc" }, "title"),
    ).toEqual({ field: "title", direction: "desc" });
  });

  it("flips priority back to ascending on the second click", () => {
    expect(
      getNextHeaderSort({ field: "priority", direction: "desc" }, "priority"),
    ).toEqual({ field: "priority", direction: "asc" });
  });

  it("returns to manual order on the third click of the same column", () => {
    expect(
      getNextHeaderSort({ field: "title", direction: "desc" }, "title"),
    ).toEqual(manual);
  });

  it("returns priority to manual order on the third click", () => {
    expect(
      getNextHeaderSort({ field: "priority", direction: "asc" }, "priority"),
    ).toEqual(manual);
  });

  it("switches straight to a different column rather than cycling", () => {
    expect(
      getNextHeaderSort({ field: "title", direction: "desc" }, "assignee"),
    ).toEqual({ field: "assignee", direction: "asc" });
  });
});
