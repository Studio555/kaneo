import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import BacklogViewSwitcher from "./backlog-view-switcher";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSwitcher(
  backlogViewMode: "list" | "table",
  setBacklogViewMode = vi.fn(),
) {
  render(
    <BacklogViewSwitcher
      backlogViewMode={backlogViewMode}
      setBacklogViewMode={setBacklogViewMode}
    />,
  );
  return setBacklogViewMode;
}

describe("BacklogViewSwitcher", () => {
  it("offers a list and a table view", () => {
    renderSwitcher("list");

    expect(screen.getByText("tasks:view.list")).toBeInTheDocument();
    expect(screen.getByText("tasks:view.table")).toBeInTheDocument();
  });

  it("does not offer the board view, which the backlog has no layout for", () => {
    renderSwitcher("list");

    expect(screen.queryByText("tasks:view.board")).not.toBeInTheDocument();
  });

  it("switches to the table view when the table button is clicked", () => {
    const setBacklogViewMode = renderSwitcher("list");

    fireEvent.click(screen.getByText("tasks:view.table"));

    expect(setBacklogViewMode).toHaveBeenCalledWith("table");
  });

  it("switches back to the list view when the list button is clicked", () => {
    const setBacklogViewMode = renderSwitcher("table");

    fireEvent.click(screen.getByText("tasks:view.list"));

    expect(setBacklogViewMode).toHaveBeenCalledWith("list");
  });

  it("marks the active view as current", () => {
    renderSwitcher("table");

    expect(
      screen.getByText("tasks:view.table").closest("button"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText("tasks:view.list").closest("button"),
    ).not.toHaveAttribute("aria-current");
  });
});
