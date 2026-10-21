import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type CreateCraftRequest = InferRequestType<
  (typeof client)["craft"]["$post"]
>["json"];

async function createCraft({ name, color, workspaceId }: CreateCraftRequest) {
  const response = await client.craft.$post({
    json: { name, color, workspaceId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default createCraft;
