import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  isBoardViewMode,
  PROJECT_ROUTE_PATHS,
  type ProjectRoute,
  type ProjectView,
  routeForView,
} from "./project-views";

export function useGoToProjectView({
  workspaceId,
  projectId,
  currentRoute,
}: {
  workspaceId: string;
  projectId: string;
  currentRoute: ProjectRoute;
}) {
  const navigate = useNavigate();
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);
  const setTaskLayout = useUserPreferencesStore((state) => state.setTaskLayout);

  return useCallback(
    (view: ProjectView) => {
      if (isBoardViewMode(view)) setViewMode(view);
      // taskLayout only tells date layouts apart, so table is stored as board.
      if (view !== "backlog") setTaskLayout(view === "table" ? "board" : view);
      const route = routeForView(view);
      if (route === currentRoute) return;
      navigate({
        to: PROJECT_ROUTE_PATHS[route],
        params: { workspaceId, projectId },
      });
    },
    [
      currentRoute,
      navigate,
      projectId,
      setTaskLayout,
      setViewMode,
      workspaceId,
    ],
  );
}
