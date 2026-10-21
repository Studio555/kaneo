import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createColumn from "./controllers/create-column";
import deleteColumn from "./controllers/delete-column";
import getColumns from "./controllers/get-columns";
import reorderColumns from "./controllers/reorder-columns";
import updateColumn from "./controllers/update-column";
import { columnListSchema, columnSchema } from "./response";
import {
  columnParam,
  createColumnBody,
  getColumnsQuery,
  projectIdParam,
  reorderColumnsBody,
  updateColumnBody,
} from "./schema";

const getColumnsRoute = createRoute({
  method: "get",
  operationId: "getColumns",
  path: "/{projectId}",
  tags: ["Columns"],
  summary: "Get columns",
  description:
    "Get a project's board columns, or with `kind=backlog` its backlog sections, ordered by position.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: getColumnsQuery },
  responses: {
    200: jsonResponse("List of columns ordered by position", columnListSchema),
    403: errorResponse("No access to the project"),
    404: errorResponse("Project not found"),
  },
});

const createColumnRoute = createRoute({
  method: "post",
  operationId: "createColumn",
  path: "/{projectId}",
  tags: ["Columns"],
  summary: "Create column",
  description:
    "Add a column to the end of a project's board, or with `kind: backlog` a section to its backlog. The slug is derived from the name and must be unique across both, with a numeric suffix such as `-2` when another column in the project already uses it.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createColumnBody } },
    },
  },
  responses: {
    200: jsonResponse("The created column", columnSchema),
    400: errorResponse("Invalid body, or a final backlog section"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    409: errorResponse("The slug is reserved for a virtual task status"),
    404: errorResponse("Project not found"),
  },
});

const reorderColumnsRoute = createRoute({
  method: "put",
  operationId: "reorderColumns",
  path: "/reorder/{projectId}",
  tags: ["Columns"],
  summary: "Reorder columns",
  description:
    "Set new positions for a project's columns and return all of its columns, board and backlog, in their new order.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: reorderColumnsBody } },
    },
  },
  responses: {
    200: jsonResponse("The reordered columns", columnListSchema),
    400: errorResponse("A column does not belong to this project"),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Project not found"),
  },
});

const updateColumnRoute = createRoute({
  method: "put",
  operationId: "updateColumn",
  path: "/{id}",
  tags: ["Columns"],
  summary: "Update column",
  description:
    "Update a column. Omitted fields are left unchanged; icon and color accept null to clear them.",
  middleware: [
    workspaceAccess.fromColumn("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: columnParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateColumnBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated column", columnSchema),
    400: errorResponse(
      "Invalid body, a renamed built-in section, or a final backlog section",
    ),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    404: errorResponse("Column not found"),
  },
});

const deleteColumnRoute = createRoute({
  method: "delete",
  operationId: "deleteColumn",
  path: "/{id}",
  tags: ["Columns"],
  summary: "Delete column",
  description:
    "Delete an empty column or backlog section. A column holding tasks is refused until they are moved or deleted, and the built-in Planned and Archived sections cannot be deleted.",
  middleware: [
    workspaceAccess.fromColumn("id"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: columnParam },
  responses: {
    200: jsonResponse("The deleted column", columnSchema),
    403: errorResponse(
      "No access to the project, or missing project:update permission",
    ),
    409: errorResponse(
      "The column still contains tasks, or is a built-in backlog section",
    ),
    404: errorResponse("Column not found"),
  },
});

const column = apiRouter()
  .openapi(getColumnsRoute, async (c) =>
    c.json(
      await getColumns(
        c.req.valid("param").projectId,
        c.req.valid("query").kind,
      ),
      200,
    ),
  )
  .openapi(createColumnRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { name, icon, color, isFinal, kind } = c.req.valid("json");
    return c.json(
      await createColumn({ projectId, name, icon, color, isFinal, kind }),
      200,
    );
  })
  .openapi(reorderColumnsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { columns } = c.req.valid("json");
    return c.json(await reorderColumns(projectId, columns), 200);
  })
  .openapi(updateColumnRoute, async (c) =>
    c.json(
      await updateColumn(c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  )
  .openapi(deleteColumnRoute, async (c) =>
    c.json(await deleteColumn(c.req.valid("param").id), 200),
  );

export default column;
