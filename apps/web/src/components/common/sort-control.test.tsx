import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SortControl from "./sort-control";

const datesEnabled = vi.hoisted(() => ({ value: true }));

vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => datesEnabled.value,
  useShowDueDates: () => datesEnabled.value,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  datesEnabled.value = true;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /tasks:sort.label/ }));
}

describe("SortControl", () => {
  it("offers assignee as a sortable field", async () => {
    render(
      <SortControl
        sort={{ field: "position", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    openMenu();

    expect(await screen.findByText("tasks:sort.fields.assignee")).toBeVisible();
  });

  it("offers craft as a sortable field", async () => {
    render(
      <SortControl
        sort={{ field: "position", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    openMenu();

    expect(await screen.findByText("tasks:properties.craft")).toBeVisible();
  });

  it("sorts by assignee name ascending when the assignee field is picked", async () => {
    const onSortChange = vi.fn();
    render(
      <SortControl
        sort={{ field: "position", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );

    openMenu();
    fireEvent.click(await screen.findByText("tasks:sort.fields.assignee"));

    expect(onSortChange).toHaveBeenCalledWith({
      field: "assignee",
      direction: "asc",
    });
  });
});

describe("SortControl with dates disabled", () => {
  it("omits due date as a sortable field", async () => {
    datesEnabled.value = false;
    render(
      <SortControl
        sort={{ field: "position", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    openMenu();

    expect(
      screen.queryByText("tasks:sort.fields.dueDate"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the generic sort label when a stale sort field is no longer offered", () => {
    datesEnabled.value = false;
    render(
      <SortControl
        sort={{ field: "dueDate", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /tasks:sort.label/ }),
    ).toBeInTheDocument();
  });
});
