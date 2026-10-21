import { cleanup, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";

vi.mock("@kaneo/libs", () => ({
  windowId: "test-window-id",
}));

// getWsUrl is covered in use-project-websocket.test.tsx.
import { useProjectWebSocket } from "./use-project-websocket";

const invalidateQueries = vi.fn();
const getQueryState = vi.fn();
const cancelQueries = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries,
    getQueryCache: () => ({ subscribe: () => () => {}, findAll: () => [] }),
    getQueryState,
    getQueryData: () => undefined,
    getQueriesData: () => [],
    cancelQueries,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

it("refreshes resource links when another client updates a task", () => {
  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  try {
    renderHook(() => useProjectWebSocket("project-1"));
    sockets[0].onmessage?.({
      data: JSON.stringify({
        type: "TASK_UPDATED",
        projectId: "project-1",
        taskId: "task-1",
      }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["external-links", "task-1"],
    });
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});
