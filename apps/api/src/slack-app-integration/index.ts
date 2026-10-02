import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import db from "../database";
import { integrationTable } from "../database/schema";
import { deletedSchema, projectIdParam } from "../integrations/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { handleSlackEvent } from "../plugins/slack-app";
import {
  normalizeSlackAppConfig,
  type SlackAppConfig,
  validateSlackAppConfig,
} from "../plugins/slack-app/config";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { slackAppIntegrationSchema } from "./response";
import { createSlackAppBody, updateSlackAppBody } from "./schema";

function toResponse(integration: {
  id: string;
  projectId: string;
  config: string;
  isActive: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const config = normalizeSlackAppConfig(
    JSON.parse(integration.config) as SlackAppConfig,
  );

  return {
    id: integration.id,
    projectId: integration.projectId,
    emoji: config.emoji ?? "",
    agentEmoji: config.agentEmoji ?? null,
    maintainerSlackUserId: config.maintainerSlackUserId ?? null,
    isActive: integration.isActive,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

async function assertValidConfig(config: SlackAppConfig) {
  const result = await validateSlackAppConfig(config);

  if (!result.valid) {
    throw new HTTPException(400, {
      message: result.errors?.join("; ") ?? "Invalid Slack app config",
    });
  }
}

async function findIntegration(projectId: string) {
  return db.query.integrationTable.findFirst({
    where: and(
      eq(integrationTable.projectId, projectId),
      eq(integrationTable.type, "slack-app"),
    ),
  });
}

async function getSlackAppIntegration(projectId: string) {
  const integration = await findIntegration(projectId);
  return integration ? toResponse(integration) : null;
}

const manageAccess = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
];

const getSlackAppIntegrationRoute = createRoute({
  method: "get",
  operationId: "getSlackAppIntegration",
  path: "/project/{projectId}",
  tags: ["Slack App"],
  summary: "Get Slack app integration",
  description:
    "Get the reaction-to-task integration for a project, or null when none is configured.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "Slack app integration details, or null",
      slackAppIntegrationSchema.nullable(),
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the project's workspace"),
  },
});

const createSlackAppIntegrationRoute = createRoute({
  method: "post",
  operationId: "createSlackAppIntegration",
  path: "/project/{projectId}",
  tags: ["Slack App"],
  summary: "Create Slack app integration",
  description:
    "Create or replace the reaction-to-task integration for a project. The Slack app's own credentials come from the instance environment.",
  middleware: manageAccess,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createSlackAppBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored integration", slackAppIntegrationSchema),
    400: errorResponse("The emoji failed validation"),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings",
    ),
  },
});

const updateSlackAppIntegrationRoute = createRoute({
  method: "patch",
  operationId: "updateSlackAppIntegration",
  path: "/project/{projectId}",
  tags: ["Slack App"],
  summary: "Update Slack app integration",
  description: "Update the integration. Omitted fields keep their value.",
  middleware: manageAccess,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSlackAppBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated integration", slackAppIntegrationSchema),
    400: errorResponse("The resulting config failed validation"),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings",
    ),
    404: errorResponse("Slack app integration not found"),
  },
});

const deleteSlackAppIntegrationRoute = createRoute({
  method: "delete",
  operationId: "deleteSlackAppIntegration",
  path: "/project/{projectId}",
  tags: ["Slack App"],
  summary: "Delete Slack app integration",
  description: "Remove the reaction-to-task integration from a project.",
  middleware: manageAccess,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The integration was removed", deletedSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings",
    ),
    404: errorResponse("Slack app integration not found"),
  },
});

const slackAppIntegration = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getSlackAppIntegrationRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getSlackAppIntegration(projectId), 200);
  })
  .openapi(createSlackAppIntegrationRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");

    const config = normalizeSlackAppConfig({
      emoji: body.emoji,
      agentEmoji: body.agentEmoji,
      maintainerSlackUserId: body.maintainerSlackUserId,
    });
    await assertValidConfig(config);
    const existing = await findIntegration(projectId);

    if (existing) {
      await db
        .update(integrationTable)
        .set({
          config: JSON.stringify(config),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(integrationTable.id, existing.id));
    } else {
      await db.insert(integrationTable).values({
        projectId,
        type: "slack-app",
        config: JSON.stringify(config),
        isActive: true,
      });
    }

    const integration = await getSlackAppIntegration(projectId);

    if (!integration) {
      throw new HTTPException(400, {
        message: "Failed to store the Slack app integration",
      });
    }

    return c.json(integration, 200);
  })
  .openapi(updateSlackAppIntegrationRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    const existing = await findIntegration(projectId);

    if (!existing) {
      throw new HTTPException(404, {
        message: "Slack app integration not found",
      });
    }

    const currentConfig = normalizeSlackAppConfig(
      JSON.parse(existing.config) as SlackAppConfig,
    );
    // An omitted field keeps its value; an empty string clears it.
    const nextConfig = normalizeSlackAppConfig({
      emoji: body.emoji ?? currentConfig.emoji,
      agentEmoji: body.agentEmoji ?? currentConfig.agentEmoji,
      maintainerSlackUserId:
        body.maintainerSlackUserId ?? currentConfig.maintainerSlackUserId,
    });
    await assertValidConfig(nextConfig);

    await db
      .update(integrationTable)
      .set({
        config: JSON.stringify(nextConfig),
        isActive: body.isActive ?? existing.isActive ?? true,
        updatedAt: new Date(),
      })
      .where(eq(integrationTable.id, existing.id));

    const integration = await getSlackAppIntegration(projectId);

    if (!integration) {
      throw new HTTPException(404, {
        message: "Slack app integration not found",
      });
    }

    return c.json(integration, 200);
  })
  .openapi(deleteSlackAppIntegrationRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const existing = await findIntegration(projectId);

    if (!existing) {
      throw new HTTPException(404, {
        message: "Slack app integration not found",
      });
    }

    await db
      .delete(integrationTable)
      .where(eq(integrationTable.id, existing.id));

    return c.json({ success: true }, 200);
  });

/**
 * Slack signs the exact bytes it sent, so the body is read raw rather than
 * through a validator.
 */
export async function handleSlackAppEventsRoute(c: Context) {
  const arrayBuffer = await c.req.arrayBuffer();
  const body = Buffer.from(arrayBuffer).toString("utf8");

  const result = await handleSlackEvent({
    body,
    timestamp: c.req.header("x-slack-request-timestamp") ?? "",
    signature: c.req.header("x-slack-signature") ?? "",
    retryNum: c.req.header("x-slack-retry-num") ?? null,
  });

  const status = result.status as ContentfulStatusCode;

  if (typeof result.body === "string") {
    return c.text(result.body, status);
  }

  return c.json(result.body, status);
}

export default slackAppIntegration;
