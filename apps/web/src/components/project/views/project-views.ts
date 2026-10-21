import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ChartGantt,
  Rows3,
  SquareKanban,
  SquircleDashed,
  Table2,
} from "lucide-react";
import type { TaskLayout } from "@/store/user-preferences";

export type ProjectView =
  | "board"
  | "list"
  | "table"
  | "backlog"
  | "calendar"
  | "gantt";

// Layouts served in place by the board route, stored as `viewMode`.
export type BoardViewMode = "board" | "list" | "table";

export type ProjectRoute = "board" | "backlog" | "calendar" | "gantt";

export const PROJECT_ROUTE_PATHS = {
  board: "/dashboard/workspace/$workspaceId/project/$projectId/board",
  backlog: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
  calendar: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
  gantt: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
} as const;

export const PROJECT_VIEWS: ReadonlyArray<{
  id: ProjectView;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "board",
    labelKey: "tasks:view.board",
    icon: SquareKanban,
  },
  {
    id: "list",
    labelKey: "tasks:view.list",
    icon: Rows3,
  },
  {
    id: "table",
    labelKey: "tasks:view.table",
    icon: Table2,
  },
  {
    id: "backlog",
    labelKey: "tasks:view.backlog",
    icon: SquircleDashed,
  },
  {
    id: "calendar",
    labelKey: "tasks:calendar.title",
    icon: CalendarDays,
  },
  {
    id: "gantt",
    labelKey: "tasks:view.gantt",
    icon: ChartGantt,
  },
];

export function isBoardViewMode(view: ProjectView): view is BoardViewMode {
  return view === "board" || view === "list" || view === "table";
}

export function routeForView(view: ProjectView): ProjectRoute {
  return isBoardViewMode(view) ? "board" : view;
}

export function resolveProjectView(
  route: ProjectRoute,
  viewMode: BoardViewMode,
): ProjectView {
  return route === "board" ? viewMode : route;
}

export const TASK_LAYOUTS = PROJECT_VIEWS.filter(
  (view) => view.id !== "backlog",
);

export function isDateView(view: ProjectView): boolean {
  return view === "calendar" || view === "gantt";
}

export function tasksViewFor(
  taskLayout: TaskLayout,
  viewMode: BoardViewMode,
  datesEnabled = true,
): ProjectView {
  return datesEnabled && (taskLayout === "calendar" || taskLayout === "gantt")
    ? taskLayout
    : viewMode;
}
