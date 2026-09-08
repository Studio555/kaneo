import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createCraft from "./controllers/create-craft";
import deleteCraft from "./controllers/delete-craft";
import getCraft from "./controllers/get-craft";
import getCraftsByWorkspaceId from "./controllers/get-crafts-by-workspace-id";
import updateCraft from "./controllers/update-craft";
import { craftListSchema, craftSchema } from "./response";
import {
  craftParam,
  createCraftBody,
  updateCraftBody,
  workspaceIdParam,
} from "./schema";

// Craft reuses the `label` permission statement rather than introducing its
// own. A new statement would be absent from every `workspace_role` row that
// already exists, and `satisfies()` denies an unknown resource key, so
// viewer/member/admin would lose craft access on every existing install.
const CRAFT_TAGS = ["Crafts"];

const getWorkspaceCraftsRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceCrafts",
  path: "/workspace/{workspaceId}",
  tags: CRAFT_TAGS,
  summary: "Get workspace crafts",
  description:
    "List the crafts defined in a workspace, ordered by name. A craft is the discipline a task belongs to, kept separate from labels so integrations cannot pollute it.",
  middleware: [workspaceAccess.fromParam()] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("List of crafts in the workspace", craftListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const getCraftRoute = createRoute({
  method: "get",
  operationId: "getCraft",
  path: "/{id}",
  tags: CRAFT_TAGS,
  summary: "Get craft",
  description: "Get a specific craft by ID",
  middleware: [workspaceAccess.fromCraft()] as const,
  request: { params: craftParam },
  responses: {
    200: jsonResponse("Craft details", craftSchema),
    400: errorResponse(
      "Unknown craft, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the craft's workspace"),
    404: errorResponse("Craft not found"),
  },
});

const createCraftRoute = createRoute({
  method: "post",
  operationId: "createCraft",
  path: "/",
  tags: CRAFT_TAGS,
  summary: "Create craft",
  description:
    "Create a craft in a workspace. Craft names are unique per workspace; re-creating an existing name returns the existing craft.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ label: ["create"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCraftBody } },
    },
  },
  responses: {
    200: jsonResponse("Craft created successfully", craftSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing label:create permission",
    ),
  },
});

const updateCraftRoute = createRoute({
  method: "put",
  operationId: "updateCraft",
  path: "/{id}",
  tags: CRAFT_TAGS,
  summary: "Update craft",
  description:
    "Rename or recolor a craft. A rename re-labels linked forge issues in the background; a colour change does not touch them.",
  middleware: [
    workspaceAccess.fromCraft(),
    requireWorkspacePermission({ label: ["update"] }),
  ] as const,
  request: {
    params: craftParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCraftBody } },
    },
  },
  responses: {
    200: jsonResponse("Craft updated successfully", craftSchema),
    400: errorResponse("Invalid body, or unknown craft"),
    403: errorResponse(
      "No workspace access, or missing label:update permission",
    ),
    404: errorResponse("Craft not found"),
    409: errorResponse("Another craft in the workspace already has that name"),
  },
});

const deleteCraftRoute = createRoute({
  method: "delete",
  operationId: "deleteCraft",
  path: "/{id}",
  tags: CRAFT_TAGS,
  summary: "Delete craft",
  description:
    "Delete a craft. Tasks carrying it are left with no craft rather than being deleted, and the `craft:` label is removed from linked forge issues.",
  middleware: [
    workspaceAccess.fromCraft(),
    requireWorkspacePermission({ label: ["delete"] }),
  ] as const,
  request: { params: craftParam },
  responses: {
    200: jsonResponse("Craft deleted successfully", craftSchema),
    400: errorResponse(
      "Unknown craft, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing label:delete permission",
    ),
    404: errorResponse("Craft not found"),
  },
});

const craft = apiRouter()
  .openapi(getWorkspaceCraftsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await getCraftsByWorkspaceId(workspaceId), 200);
  })
  .openapi(getCraftRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await getCraft(id), 200);
  })
  .openapi(createCraftRoute, async (c) => {
    const { name, color, workspaceId } = c.req.valid("json");
    return c.json(await createCraft(name, color, workspaceId), 200);
  })
  .openapi(updateCraftRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { name, color } = c.req.valid("json");
    return c.json(await updateCraft(id, name, color), 200);
  })
  .openapi(deleteCraftRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await deleteCraft(id), 200);
  });

export default craft;
