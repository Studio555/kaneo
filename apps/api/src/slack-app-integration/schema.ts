import { z } from "../openapi";

export const createSlackAppBody = z.object({
  emoji: z.string().optional(),
  agentEmoji: z.string().optional().openapi({
    description:
      "The reaction that starts an agent fix, without surrounding colons. An empty string turns agent fixes off.",
  }),
  maintainerSlackUserId: z.string().optional().openapi({
    description:
      "Slack user id to message when the agent runner needs a person, such as signing Codex in again. An empty string clears it.",
  }),
});

export const updateSlackAppBody = z.object({
  emoji: z.string().optional(),
  agentEmoji: z.string().optional().openapi({
    description:
      "The reaction that starts an agent fix, without surrounding colons. An empty string turns agent fixes off.",
  }),
  maintainerSlackUserId: z.string().optional().openapi({
    description:
      "Slack user id to message when the agent runner needs a person, such as signing Codex in again. An empty string clears it.",
  }),
  isActive: z.boolean().optional(),
});
