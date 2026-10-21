import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type DeleteCraftRequest = InferRequestType<
  (typeof client)["craft"][":id"]["$delete"]
>["param"];

async function deleteCraft({ id }: DeleteCraftRequest) {
  const response = await client.craft[":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default deleteCraft;
