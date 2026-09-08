import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type GetCraftsByWorkspaceRequest = InferRequestType<
  (typeof client)["craft"]["workspace"][":workspaceId"]["$get"]
>["param"];

async function getCraftsByWorkspace({
  workspaceId,
}: GetCraftsByWorkspaceRequest) {
  const response = await client.craft.workspace[":workspaceId"].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default getCraftsByWorkspace;
