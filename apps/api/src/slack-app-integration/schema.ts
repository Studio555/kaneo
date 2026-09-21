import { z } from "../openapi";

export const createSlackAppBody = z.object({
  emoji: z.string().optional(),
});

export const updateSlackAppBody = z.object({
  emoji: z.string().optional(),
  isActive: z.boolean().optional(),
});
