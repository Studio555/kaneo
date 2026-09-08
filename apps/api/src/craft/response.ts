import { responseTimestamp, z } from "../openapi";

export const craftSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
    color: z.string(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Craft");

export const craftListSchema = z.array(craftSchema);
