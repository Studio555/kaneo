import { describe, expect, it } from "vitest";
import {
  getTableGridTemplate,
  getVisibleTableColumns,
  type TableColumnVisibility,
} from "./columns";

const allVisible: TableColumnVisibility = {
  showAssignees: true,
  showDueDates: true,
  showLabels: true,
  showPriority: true,
};

function keys(visibility: TableColumnVisibility) {
  return getVisibleTableColumns(visibility).map((column) => column.key);
}

describe("getVisibleTableColumns", () => {
  it("shows every column when all display preferences are enabled", () => {
    expect(keys(allVisible)).toEqual([
      "name",
      "status",
      "assignee",
      "priority",
      "dueDate",
      "craft",
      "labels",
    ]);
  });

  it("always keeps name and status even with every optional column hidden", () => {
    expect(
      keys({
        showAssignees: false,
        showDueDates: false,
        showLabels: false,
        showPriority: false,
      }),
    ).toEqual(["name", "status", "craft"]);
  });

  it("hides the assignee column when assignees are disabled", () => {
    expect(keys({ ...allVisible, showAssignees: false })).not.toContain(
      "assignee",
    );
  });

  it("hides the due date column when due dates are disabled", () => {
    expect(keys({ ...allVisible, showDueDates: false })).not.toContain(
      "dueDate",
    );
  });

  it("hides the labels column when labels are disabled", () => {
    expect(keys({ ...allVisible, showLabels: false })).not.toContain("labels");
  });

  it("hides the priority column when priority is disabled", () => {
    expect(keys({ ...allVisible, showPriority: false })).not.toContain(
      "priority",
    );
  });

  it("maps sortable columns to their sort field", () => {
    const columns = getVisibleTableColumns(allVisible);
    const sortFieldByKey = Object.fromEntries(
      columns.map((column) => [column.key, column.sortField]),
    );

    expect(sortFieldByKey).toEqual({
      name: "title",
      status: null,
      assignee: "assignee",
      priority: "priority",
      dueDate: "dueDate",
      craft: "craft",
      labels: null,
    });
  });

  it("keeps the craft column visible, since craft has no display preference", () => {
    expect(keys({ ...allVisible, showLabels: false })).toContain("craft");
  });

  it("gives every column a translation key", () => {
    for (const column of getVisibleTableColumns(allVisible)) {
      expect(column.labelKey).toMatch(/^tasks:/);
    }
  });
});

describe("getTableGridTemplate", () => {
  it("joins the widths of the visible columns into one grid track list", () => {
    const columns = getVisibleTableColumns({
      ...allVisible,
      showLabels: false,
    });

    expect(getTableGridTemplate(columns)).toBe(
      columns.map((column) => column.width).join(" "),
    );
  });

  it("shrinks the track list when a column is hidden", () => {
    const withLabels = getTableGridTemplate(getVisibleTableColumns(allVisible));
    const withoutLabels = getTableGridTemplate(
      getVisibleTableColumns({ ...allVisible, showLabels: false }),
    );

    expect(withoutLabels.split(" ").length).toBeLessThan(
      withLabels.split(" ").length,
    );
  });
});
