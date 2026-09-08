import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const DISABLED_MESSAGE = "Date fields are disabled on this instance";
const A_DATE = "2026-08-01T00:00:00.000Z";
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

  it("rejects a date on import", async () => {
    process.env.DISABLE_DATES = "true";
    const res = await app.request(`/api/task/import/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tasks: [{ title: "imported", status: "to-do", dueDate: A_DATE }],
      }),
    });
    expect(res.status).toBe(422);
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

  it("echoing a stored due date on a full update is accepted, but changing it still 422s, and clearing still works", async () => {
    delete process.env.DISABLE_DATES;
    const created = await app.request(`/api/task/${projectId}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "echo-target",
        description: "",
        priority: "medium",
        status: "to-do",
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
      dueDate: string | null;
    };
    expect(task.dueDate).not.toBeNull();

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
    expect(await changed.text()).toContain(DISABLED_MESSAGE);

    // Clearing the date (omitting it from a full update) must still be
    // allowed even while disabled.
    const cleared = await app.request(`/api/task/${createdTask.id}`, {
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
    expect(cleared.status).toBe(200);
    const clearedTask = (await cleared.json()) as { dueDate: string | null };
    expect(clearedTask.dueDate).toBeNull();
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
