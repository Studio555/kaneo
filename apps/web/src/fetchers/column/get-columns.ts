import { client } from "@kaneo/libs";

async function getColumns(projectId: string, kind?: "board" | "backlog") {
  const response = await client.column[":projectId"].$get({
    param: { projectId },
    query: kind ? { kind } : {},
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getColumns;
