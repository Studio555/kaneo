import { responseTimestamp, z } from "../openapi";

export const slackAppIntegrationSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    emoji: z.string().openapi({
      description:
        "The reaction that files a message as a task, without surrounding colons.",
    }),
    isActive: z.boolean().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SlackAppIntegration");
