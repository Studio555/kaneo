import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vite-plus/test";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const DISABLED_MESSAGE = "Date fields are disabled on this instance";
const A_DATE = "2026-08-01T00:00:00.000Z";
const A_START_DATE = "2026-07-01T00:00:00.000Z";
const JSON_HEADERS = { "content-type": "application/json" };

describe("API integration: dates disabled", () => {
  let app: ReturnType<typeof createApp>["app"];
  let user: Awaited<ReturnType<typeof createWorkspaceMember>>["user"];
  let projectId: string;
  let seededTaskId: string;
  let originalFlag: string | undefined;

  beforeAll(async () => {
    originalFlag = process.env.DISABLE_DATES;
    delete process.env.DISABLE_DATES;

    await resetTestDatabase();

    const member = await createWorkspaceMember();
    user = member.user;
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    projectId = project.id;

    mockAuthenticatedSession(user);
    ({ app } = createApp());

    // Seed a task that already has a due date, while dates are still enabled.
    const seeded = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "seeded",
        description: "",
        priority: "medium",
        status: "to-do",
        dueDate: A_DATE,
      }),
    });
    expect(seeded.status).toBe(200);
    seededTaskId = ((await seeded.json()) as { id: string }).id;
  });

  afterAll(() => {
    if (originalFlag === undefined) {
      delete process.env.DISABLE_DATES;
    } else {
      process.env.DISABLE_DATES = originalFlag;
    }
  });

  // The suite's global afterEach (tests/api-integration/setup.ts) restores
  // all mocks after every test, so the session mock must be re-armed before
  // each one rather than once in beforeAll.
  beforeEach(() => {
    mockAuthenticatedSession(user);
  });

  it("accepts a date write while dates are enabled", async () => {
    delete process.env.DISABLE_DATES;
    const res = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "enabled",
        description: "",
        priority: "medium",
        status: "to-do",
        dueDate: A_DATE,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a date on task creation", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "nope",
        description: "",
        priority: "medium",
        status: "to-do",
        dueDate: A_DATE,
      }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain(DISABLED_MESSAGE);
  });

  it("rejects the dedicated due-date route", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/task/due-date/${seededTaskId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ dueDate: A_DATE }),
    });
    expect(res.status).toBe(422);
  });

  it("still allows a bulk due-date clear", async () => {
    process.env.DISABLE_DATES = "true";
    // An empty value means "clear" in `bulkUpdateBody`, exactly as on the
    // dedicated due-date route; a disabled instance must not block it.
    const res = await app.request("/api/task/bulk", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        taskIds: [seededTaskId],
        operation: "updateDueDate",
        value: "",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a bulk due-date update", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request("/api/task/bulk", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        taskIds: [seededTaskId],
        operation: "updateDueDate",
        value: A_DATE,
      }),
    });
    expect(res.status).toBe(422);
  });

  it("reports a dated import row as a per-task failure instead of aborting the import", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/task/import/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tasks: [
          { title: "undated import", status: "to-do" },
          { title: "dated import", status: "to-do", dueDate: A_DATE },
          { title: "later undated import", status: "to-do" },
        ],
      }),
    });

    // Aborting mid-loop would commit the first row, 422 with no body, and
    // leave the caller unable to tell what landed.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: {
        total: number;
        successful: number;
        failed: number;
        tasks: { success: boolean; error?: string; task?: unknown }[];
      };
    };
    expect(body.results.total).toBe(3);
    expect(body.results.successful).toBe(2);
    expect(body.results.failed).toBe(1);
    expect(body.results.tasks[1]).toMatchObject({
      success: false,
      error: DISABLED_MESSAGE,
    });
    // The row after the dated one still imported, proving the loop continued.
    expect(body.results.tasks[2]).toMatchObject({ success: true });
  });

  it("imports dated rows normally when dates are enabled", async () => {
    delete process.env.DISABLE_DATES;
    const res = await app.request(`/api/task/import/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tasks: [{ title: "enabled import", status: "to-do", dueDate: A_DATE }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { successful: number; failed: number };
    };
    expect(body.results.successful).toBe(1);
    expect(body.results.failed).toBe(0);
  });

  it("still allows clearing a date", async () => {
    process.env.DISABLE_DATES = "true";
    // The due-date route treats an empty string as "clear"; it never reaches
    // validateAndParseDate (and therefore the guard) at all.
    const res = await app.request(`/api/task/due-date/${seededTaskId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ dueDate: "" }),
    });
    expect(res.status).toBe(200);
  });

  it("still returns a stored due date while disabled", async () => {
    // Re-seed a date with the flag off, then read it back with the flag on.
    delete process.env.DISABLE_DATES;
    const reseed = await app.request(`/api/task/due-date/${seededTaskId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ dueDate: A_DATE }),
    });
    expect(reseed.status).toBe(200);

    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/task/${seededTaskId}`);
    expect(res.status).toBe(200);
    const task = (await res.json()) as { dueDate: string | null };
    expect(task.dueDate).not.toBeNull();
  });

  it("rejects creating a time entry while dates are disabled", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request("/api/time-entry", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        taskId: seededTaskId,
        startTime: A_DATE,
      }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain(DISABLED_MESSAGE);
  });

  it("still reads time entries while dates are disabled", async () => {
    // Create one with the flag off, then read it back with the flag on.
    delete process.env.DISABLE_DATES;
    const created = await app.request("/api/time-entry", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        taskId: seededTaskId,
        startTime: A_DATE,
      }),
    });
    expect(created.status).toBe(200);
    const entryId = ((await created.json()) as { id: string }).id;

    process.env.DISABLE_DATES = "true";
    const read = await app.request(`/api/time-entry/${entryId}`, {
      headers: JSON_HEADERS,
    });
    expect(read.status).toBe(200);
  });

  it("echoing a stored due date on a full update is accepted, changing it still 422s, and omitting it preserves it", async () => {
    delete process.env.DISABLE_DATES;
    const created = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "echo-target",
        description: "",
        priority: "medium",
        status: "to-do",
        startDate: A_START_DATE,
        dueDate: A_DATE,
      }),
    });
    expect(created.status).toBe(200);
    const createdTask = (await created.json()) as { id: string };

    process.env.DISABLE_DATES = "true";

    const fetched = await app.request(`/api/task/${createdTask.id}`);
    expect(fetched.status).toBe(200);
    const task = (await fetched.json()) as {
      description: string;
      status: string;
      priority: string;
      projectId: string;
      position: number;
      startDate: string | null;
      dueDate: string | null;
    };
    expect(task.dueDate).not.toBeNull();
    expect(task.startDate).not.toBeNull();

    // A title-only change that echoes the stored due date is not a date
    // change and must be accepted.
    const renamed = await app.request(`/api/task/${createdTask.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "renamed while disabled",
        description: task.description,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        position: task.position,
        dueDate: task.dueDate,
      }),
    });
    expect(renamed.status).toBe(200);
    const renamedTask = (await renamed.json()) as {
      title: string;
      dueDate: string | null;
    };
    expect(renamedTask.title).toBe("renamed while disabled");
    expect(renamedTask.dueDate).toBe(task.dueDate);

    // Actually changing the date to a different value is a real change and
    // must still 422.
    const changed = await app.request(`/api/task/${createdTask.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "renamed while disabled",
        description: task.description,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        position: task.position,
        dueDate: "2026-09-01T00:00:00.000Z",
      }),
    });
    expect(changed.status).toBe(422);

    // An unparseable date cannot be an echo of the stored value, so it is a
    // change attempt too. The caller should be told the feature is disabled,
    // not handed a parse error for a field this instance will not accept
    // whatever its format.
    const malformed = await app.request(`/api/task/${createdTask.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "renamed while disabled",
        description: task.description,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        position: task.position,
        dueDate: "not-a-date",
      }),
    });
    expect(malformed.status).toBe(422);
    expect(await malformed.text()).toContain(DISABLED_MESSAGE);

    // With dates enabled the same body is a plain validation error, so the
    // 422 above is genuinely about the flag and not about the parse failing.
    delete process.env.DISABLE_DATES;
    const malformedEnabled = await app.request(`/api/task/${createdTask.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "renamed while disabled",
        description: task.description,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        position: task.position,
        dueDate: "not-a-date",
      }),
    });
    expect(malformedEnabled.status).toBe(400);
    process.env.DISABLE_DATES = "true";
    expect(await changed.text()).toContain(DISABLED_MESSAGE);

    // Omitting the date from a full update — what a third-party script doing
    // a legitimate PUT looks like — must not destroy it. While disabled this
    // route never writes the date columns at all, so the stored value
    // survives.
    const omitted = await app.request(`/api/task/${createdTask.id}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "renamed while disabled",
        description: task.description,
        priority: task.priority,
        status: task.status,
        projectId: task.projectId,
        position: task.position,
      }),
    });
    expect(omitted.status).toBe(200);
    const omittedTask = (await omitted.json()) as {
      startDate: string | null;
      dueDate: string | null;
    };
    expect(omittedTask.dueDate).toBe(task.dueDate);
    expect(omittedTask.startDate).toBe(task.startDate);

    // The stored dates are still there on a fresh read, not just echoed back.
    const refetched = await app.request(`/api/task/${createdTask.id}`);
    expect(refetched.status).toBe(200);
    const refetchedTask = (await refetched.json()) as {
      startDate: string | null;
      dueDate: string | null;
    };
    expect(refetchedTask.dueDate).toBe(task.dueDate);
    expect(refetchedTask.startDate).toBe(task.startDate);

    // Positive control: with dates enabled the same omission still clears the
    // column, so the assertions above are about the flag and not about the
    // route having stopped writing dates altogether.
    delete process.env.DISABLE_DATES;
    const clearedWhileEnabled = await app.request(
      `/api/task/${createdTask.id}`,
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          title: "renamed while enabled",
          description: task.description,
          priority: task.priority,
          status: task.status,
          projectId: task.projectId,
          position: task.position,
        }),
      },
    );
    expect(clearedWhileEnabled.status).toBe(200);
    const clearedTask = (await clearedWhileEnabled.json()) as {
      startDate: string | null;
      dueDate: string | null;
    };
    expect(clearedTask.dueDate).toBeNull();
    expect(clearedTask.startDate).toBeNull();
  });

  it("rejects updating a time entry while dates are disabled", async () => {
    // Create one with the flag off so the workspace-access lookup succeeds,
    // then attempt to update it with the flag on.
    delete process.env.DISABLE_DATES;
    const created = await app.request("/api/time-entry", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        taskId: seededTaskId,
        startTime: A_DATE,
      }),
    });
    expect(created.status).toBe(200);
    const entryId = ((await created.json()) as { id: string }).id;

    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/time-entry/${entryId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ startTime: A_DATE }),
    });
    expect(res.status).toBe(422);
  });
});
