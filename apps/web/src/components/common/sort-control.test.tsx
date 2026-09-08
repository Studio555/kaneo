import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SortControl from "./sort-control";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
