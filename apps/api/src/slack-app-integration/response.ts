import { responseTimestamp, z } from "../openapi";

export const slackAppIntegrationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    emoji: z.string().openapi({
      description:
        "The reaction that files a message as a task, without surrounding colons.",
    }),
    agentEmoji: z.string().nullable().openapi({
      description:
        "The reaction that starts an agent fix, or null when agent fixes are off.",
    }),
    maintainerSlackUserId: z.string().nullable().openapi({
      description:
        "Slack user messaged when the agent runner needs a person, or null.",
    }),
    isActive: z.boolean().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SlackAppIntegration");
