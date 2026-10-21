import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { LayoutSwitch } from "./layout-switch";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  setViewMode: vi.fn(),
  setTaskLayout: vi.fn(),
  datesEnabled: true,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => m.navigate }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => m.datesEnabled,
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (selector: (state: typeof m) => unknown) =>
    selector(m),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.datesEnabled = true;
});

function renderSwitch() {
  render(
    <LayoutSwitch
      workspaceId="w"
      projectId="p"
      currentRoute="board"
      currentView="board"
    />,
  );
}

it("marks the current layout as pressed", () => {
  renderSwitch();
  expect(
    screen.getByRole("button", { name: "tasks:view.board" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("button", { name: "tasks:view.gantt" }),
  ).toHaveAttribute("aria-pressed", "false");
});

it("switches to list in place and navigates to other layouts", () => {
  renderSwitch();

  fireEvent.click(screen.getByRole("button", { name: "tasks:view.list" }));
  expect(m.setViewMode).toHaveBeenCalledWith("list");
  expect(m.navigate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "tasks:calendar.title" }));
  expect(m.setTaskLayout).toHaveBeenCalledWith("calendar");
  expect(m.navigate).toHaveBeenCalledWith({
    to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
    params: { workspaceId: "w", projectId: "p" },
  });
});

it("hides the calendar and gantt layouts when dates are disabled", () => {
  m.datesEnabled = false;
  renderSwitch();

  expect(
    screen.queryByRole("button", { name: "tasks:calendar.title" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "tasks:view.gantt" })).toBeNull();
});
