import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type UpdateCraftRequest = InferRequestType<
  (typeof client)["craft"][":id"]["$put"]
>["json"] &
  InferRequestType<(typeof client)["craft"][":id"]["$put"]>["param"];

async function updateCraft({ id, name, color }: UpdateCraftRequest) {
  const response = await client.craft[":id"].$put({
    param: { id },
    json: { name, color },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default updateCraft;
