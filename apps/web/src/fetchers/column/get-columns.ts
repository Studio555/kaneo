import { client } from "@kaneo/libs";

import { HttpError } from "@/lib/http-error";

async function getColumns(projectId: string, kind?: "board" | "backlog") {
  const response = await client.column[":projectId"].$get({
    param: { projectId },
    query: kind ? { kind } : {},
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default getColumns;
