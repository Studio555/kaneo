import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../apps/api/src/mcp/tools";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

type ToolRegistration = {
  inputSchema: { shape: Record<string, unknown> };
  callback: ToolCallback;
};

function collectToolRegistrations() {
  const collected = new Map<string, ToolRegistration>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, config, callback) =>
      collected.set(name, { inputSchema: config.inputSchema, callback }),
  };
  registerMcpTools(registrar, "http://api.test", "test-token");
  return collected;
}

const toolRegistrations = collectToolRegistrations();

function collectToolRegistrationsWithDatesDisabled() {
  const original = process.env.DISABLE_DATES;
  process.env.DISABLE_DATES = "true";
  try {
    return collectToolRegistrations();
  } finally {
    if (original === undefined) {
      delete process.env.DISABLE_DATES;
    } else {
      process.env.DISABLE_DATES = original;
    }
  }
}

function callFrom(
  registrations: Map<string, ToolRegistration>,
  name: string,
  args: unknown = {},
) {
  const tool = registrations.get(name)?.callback;
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool(args);
}

function call(name: string, args: unknown = {}) {
  return callFrom(toolRegistrations, name, args);
}

let apiFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest() {
  const [input, init] = apiFetch.mock.calls.at(-1) as [
    RequestInfo | URL,
    RequestInit | undefined,
  ];
  return {
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    auth: new Headers(init?.headers).get("authorization"),
  };
}

describe("MCP tool catalog", () => {
  it("resolves workspace members", async () => {
    await call("list_workspace_members", { workspaceId: "ws 1" });

    const request = lastRequest();
    expect(request.url).toBe("http://api.test/api/workspace/ws%201/members");
    expect(request.auth).toBe("Bearer test-token");
  });

  it("passes only the search filters that were supplied", async () => {
    await call("search", { q: "login bug" });
    expect(lastRequest().url).toBe("http://api.test/api/search?q=login+bug");

    await call("search", {
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: 5,
    });
    const url = new URL(lastRequest().url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "login bug",
      type: "tasks",
      projectId: "p1",
      limit: "5",
    });
  });

  it("rejects a search limit above the API maximum", async () => {
    const result = await call("search", { q: "x", limit: 500 });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the columns whose slugs are valid task statuses", async () => {
    await call("list_project_columns", { projectId: "p1" });

    expect(lastRequest().url).toBe("http://api.test/api/column/p1");
  });

  it("reads custom field definitions and task values", async () => {
    await call("list_project_custom_fields", { projectId: "p1" });
    expect(lastRequest().url).toBe(
      "http://api.test/api/custom-field/project/p1",
    );

    await call("get_task_custom_field_values", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/custom-field/task/t1");
  });

  it("sets a multiselect custom field value and clears it", async () => {
    await call("set_task_custom_field_value", {
      taskId: "t1",
      fieldId: "f1",
      value: ["Frontend", "API"],
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/custom-field/value",
      method: "PUT",
      body: { taskId: "t1", fieldId: "f1", value: '["Frontend","API"]' },
    });

    await call("set_task_custom_field_value", {
      taskId: "t1",
      fieldId: "f1",
      value: null,
    });
    expect(lastRequest().body).toEqual({
      taskId: "t1",
      fieldId: "f1",
      value: "",
    });
  });

  it("deletes a task", async () => {
    await call("delete_task", { taskId: "t1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/t1",
      method: "DELETE",
    });
  });

  it("duplicates a task and only sends a title when one is given", async () => {
    await call("duplicate_task", { taskId: "t 1" });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/duplicate/t%201",
      method: "POST",
      body: {},
    });

    await call("duplicate_task", { taskId: "t1", title: "Checklist (copy)" });
    expect(lastRequest().body).toEqual({ title: "Checklist (copy)" });
  });

  it("assigns and unassigns a task", async () => {
    await call("update_task_assignee", { taskId: "t1", userId: "u1" });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/assignee/t1",
      method: "PUT",
      body: { userId: "u1" },
    });

    await call("update_task_assignee", { taskId: "t1", userId: null });
    expect(lastRequest().body).toEqual({ userId: null });
  });

  it("rejects an empty assignee id rather than sending it", async () => {
    const result = await call("update_task_assignee", {
      taskId: "t1",
      userId: "",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sets and clears a due date", async () => {
    await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "2026-09-01T10:00:00Z",
    });
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/task/due-date/t1",
      method: "PUT",
      body: { dueDate: "2026-09-01T10:00:00Z" },
    });

    await call("update_task_due_date", { taskId: "t1" });
    expect(lastRequest().body).toEqual({});
  });

  it("rejects a due date that is not an ISO date-time", async () => {
    const result = await call("update_task_due_date", {
      taskId: "t1",
      dueDate: "next tuesday",
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads time entries for a task and by id", async () => {
    await call("list_task_time_entries", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/task/t1");

    await call("get_time_entry", { id: "te1" });
    expect(lastRequest().url).toBe("http://api.test/api/time-entry/te1");
  });

  it("creates a running time entry when endTime is omitted", async () => {
    await call("create_time_entry", {
      taskId: "t1",
      startTime: "2026-08-10T09:00:00Z",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry",
      method: "POST",
      body: { taskId: "t1", startTime: "2026-08-10T09:00:00Z" },
    });
    expect(lastRequest().body).not.toHaveProperty("endTime");
  });

  it("updates a time entry", async () => {
    await call("update_time_entry", {
      id: "te1",
      startTime: "2026-08-10T09:00:00Z",
      endTime: "2026-08-10T10:30:00Z",
      description: "pairing",
    });

    expect(lastRequest()).toMatchObject({
      url: "http://api.test/api/time-entry/te1",
      method: "PUT",
      body: {
        startTime: "2026-08-10T09:00:00Z",
        endTime: "2026-08-10T10:30:00Z",
        description: "pairing",
      },
    });
  });

  it("reads task activity and notifications", async () => {
    await call("list_task_activity", { taskId: "t1" });
    expect(lastRequest().url).toBe("http://api.test/api/activity/t1");

    await call("list_notifications");
    expect(lastRequest().url).toBe("http://api.test/api/notification");
  });

  it("surfaces an API failure as a tool error", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ message: "Task not found" }, { status: 404 }),
    );

    const result = await call("delete_task", { taskId: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Task not found");
  });
});

describe("MCP tools with dates disabled", () => {
  const disabledTools = collectToolRegistrationsWithDatesDisabled();

  it("does not register the date and time-entry tools", () => {
    for (const name of [
      "update_task_due_date",
      "get_time_entry",
      "create_time_entry",
      "update_time_entry",
      "list_task_time_entries",
    ]) {
      expect(disabledTools.has(name)).toBe(false);
    }
  });

  it("still registers the non-date tools", () => {
    for (const name of ["whoami", "create_task", "update_task", "list_tasks"]) {
      expect(disabledTools.has(name)).toBe(true);
    }
  });

  it("no longer advertises startDate/dueDate on create_task and update_task", () => {
    for (const name of ["create_task", "update_task"]) {
      const shape = disabledTools.get(name)?.inputSchema.shape ?? {};
      expect(Object.keys(shape)).not.toContain("startDate");
      expect(Object.keys(shape)).not.toContain("dueDate");
    }
  });

  it("still advertises startDate/dueDate on create_task and update_task when dates are enabled", () => {
    for (const name of ["create_task", "update_task"]) {
      const shape = toolRegistrations.get(name)?.inputSchema.shape ?? {};
      expect(Object.keys(shape)).toContain("startDate");
      expect(Object.keys(shape)).toContain("dueDate");
    }
  });

  it("echoes a task's stored dates on update_task instead of treating them as a change", async () => {
    const existingTask = {
      id: "t1",
      title: "old title",
      description: "",
      status: "to-do",
      priority: "medium",
      projectId: "p1",
      position: 1,
      startDate: "2026-08-01T00:00:00.000Z",
      dueDate: "2026-08-10T00:00:00.000Z",
    };
    apiFetch.mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return Response.json(existingTask);
        }
        return Response.json({ ok: true });
      },
    );

    const result = await callFrom(disabledTools, "update_task", {
      taskId: "t1",
      title: "new title",
    });

    expect(result.isError).toBeFalsy();
    const putRequest = lastRequest();
    expect(putRequest.method).toBe("PUT");
    expect(putRequest.body).toMatchObject({
      title: "new title",
      startDate: existingTask.startDate,
      dueDate: existingTask.dueDate,
    });
  });
});
