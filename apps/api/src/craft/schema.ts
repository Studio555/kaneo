import { z } from "../openapi";

export const craftParam = z.object({ id: z.string() });

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const createCraftBody = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().trim().min(1),
  workspaceId: z.string(),
});

export const updateCraftBody = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().trim().min(1),
});
