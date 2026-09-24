import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

async function getTasks(projectId: string) {
  const response = await client.task.tasks[":projectId"].$get({
    param: { projectId },
    // No filters: the route returns the whole board on a single page.
    query: {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch tasks");
  }

  const json = await response.json();
  // Deprecated duplicates of two backlogSections entries; dropping them keeps
  // one copy of each backlog task for cache updates to keep in step.
  const {
    plannedTasks: _planned,
    archivedTasks: _archived,
    ...board
  } = json.data;

  return board;
}

export default getTasks;
