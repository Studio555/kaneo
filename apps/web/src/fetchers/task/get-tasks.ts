import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { ProjectWithTasks } from "@/types/project";
import { loadBoardPages } from "./load-board-pages";

type RawBoard = InferResponseType<
  (typeof client)["task"]["tasks"][":projectId"]["$get"],
  200
>["data"];

// Deprecated duplicates of two backlogSections entries; dropping them keeps
// one copy of each backlog task for cache updates to keep in step.
function withoutLegacyBacklog({
  plannedTasks: _planned,
  archivedTasks: _archived,
  ...board
}: RawBoard): ProjectWithTasks {
  return board;
}

async function getTasks(
  projectId: string,
  signal?: AbortSignal,
  onProgress?: (board: ProjectWithTasks) => void,
) {
  const board = await loadBoardPages(
    async (page, relatedPage) => {
      const response = await client.task.tasks[":projectId"].$get(
        {
          param: { projectId },
          query: {
            page: String(page),
            limit: "100",
            ...(relatedPage ? { relatedPage: String(relatedPage) } : {}),
          },
        },
        { init: { signal } },
      );
      if (!response.ok)
        throw new HttpError(response.status, "Failed to fetch tasks");
      return response.json();
    },
    signal,
    onProgress && ((snapshot) => onProgress(withoutLegacyBacklog(snapshot))),
  );
  return withoutLegacyBacklog(board);
}
export default getTasks;
