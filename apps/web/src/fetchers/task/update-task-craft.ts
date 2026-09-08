import { client } from "@kaneo/libs";

async function updateTaskCraft(taskId: string, craftId: string | null) {
  const response = await client.task.craft[":id"].$put({
    param: { id: taskId },
    json: { craftId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();

  return data;
}

export default updateTaskCraft;
