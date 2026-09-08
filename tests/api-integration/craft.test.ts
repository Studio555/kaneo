import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function createCraft(
  workspaceId: string,
  name: string,
  color = "#3b82f6",
) {
  const [craft] = await db
    .insert(schema.craftTable)
    .values({ workspaceId, name, color })
    .returning();
  return craft;
}

async function createTask(projectId: string, craftId: string | null = null) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: "Integration Task",
      status: "to-do",
      craftId,
    })
    .returning();
  return task;
}

describe("API integration: crafts", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated craft creation", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Engineering",
        color: "#3b82f6",
        workspaceId: "workspace-missing",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("creates and lists crafts for a workspace member", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const created = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Engineering",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
      }),
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      workspaceId: member.workspace.id,
      name: "Engineering",
      color: "#3b82f6",
    });

    const listed = await app.request(
      `/api/craft/workspace/${member.workspace.id}`,
    );

    expect(listed.status).toBe(200);
    const crafts = (await listed.json()) as Array<{ name: string }>;
    expect(crafts.map((craft) => craft.name)).toEqual(["Engineering"]);
  });

  it("returns the existing craft instead of erroring on a duplicate name", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const body = JSON.stringify({
      name: "Art",
      color: "#f43f5e",
      workspaceId: member.workspace.id,
    });

    const first = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const second = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstCraft = (await first.json()) as { id: string };
    const secondCraft = (await second.json()) as { id: string };
    expect(secondCraft.id).toBe(firstCraft.id);

    const rows = await db
      .select()
      .from(schema.craftTable)
      .where(eq(schema.craftTable.workspaceId, member.workspace.id));
    expect(rows).toHaveLength(1);
  });

  it("treats a case variant as the same craft name", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Engineering",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
      }),
    });
    const variant = await app.request("/api/craft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "engineering",
        color: "#3b82f6",
        workspaceId: member.workspace.id,
      }),
    });

    expect(first.status).toBe(200);
    expect(variant.status).toBe(200);

    // Inbound `craft:` labels resolve case-insensitively, so allowing both
    // spellings to exist would make that resolution ambiguous.
    const firstCraft = (await first.json()) as { id: string };
    const variantCraft = (await variant.json()) as { id: string };
    expect(variantCraft.id).toBe(firstCraft.id);

    const rows = await db
      .select()
      .from(schema.craftTable)
      .where(eq(schema.craftTable.workspaceId, member.workspace.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a rename onto another craft's name in a different case", async () => {
    const member = await createWorkspaceMember();
    const art = await createCraft(member.workspace.id, "Art");
    await createCraft(member.workspace.id, "Engineering");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/craft/${art.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ENGINEERING", color: "#3b82f6" }),
    });

    expect(response.status).toBe(409);
  });

  it("keeps craft vocabularies separate per workspace", async () => {
    const owner = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();
    await createCraft(owner.workspace.id, "Engineering");

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/craft/workspace/${owner.workspace.id}`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects assigning a craft that belongs to another workspace", async () => {
    const member = await createWorkspaceMember();
    const other = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createTask(project.project.id);
    const foreignCraft = await createCraft(other.workspace.id, "Engineering");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/task/craft/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ craftId: foreignCraft.id }),
    });

    expect(response.status).toBe(400);

    const [row] = await db
      .select({ craftId: schema.taskTable.craftId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(row?.craftId).toBeNull();
  });

  it("sets and clears a task's craft", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createTask(project.project.id);
    const craft = await createCraft(member.workspace.id, "Audio");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const set = await app.request(`/api/task/craft/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ craftId: craft.id }),
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ craftId: craft.id });

    const cleared = await app.request(`/api/task/craft/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ craftId: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ craftId: null });
  });

  it("writes a craft_changed activity entry", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await createTask(project.project.id);
    const craft = await createCraft(member.workspace.id, "Narrative");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await app.request(`/api/task/craft/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ craftId: craft.id }),
    });

    // The activity is written by the task.craft_changed subscriber rather than
    // inside the request, exactly as the priority path works, so it lands
    // shortly after the response.
    const craftActivity = await vi.waitFor(async () => {
      const activities = await db
        .select()
        .from(schema.activityTable)
        .where(
          and(
            eq(schema.activityTable.taskId, task.id),
            eq(schema.activityTable.type, "craft_changed"),
          ),
        );

      expect(activities).toHaveLength(1);
      return activities[0];
    });

    expect(craftActivity).toMatchObject({
      taskId: task.id,
      userId: member.user.id,
      type: "craft_changed",
      eventData: {
        oldCraftName: null,
        newCraftName: "Narrative",
      },
    });
  });

  it("leaves tasks in place when their craft is deleted", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const craft = await createCraft(member.workspace.id, "Design");
    const task = await createTask(project.project.id, craft.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/craft/${craft.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    // ON DELETE SET NULL: the task survives, uncrafted. Labels cascade
    // instead, because there the row *is* the attachment.
    const [row] = await db
      .select({ id: schema.taskTable.id, craftId: schema.taskTable.craftId })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));

    expect(row?.id).toBe(task.id);
    expect(row?.craftId).toBeNull();
  });

  it("removes a workspace's crafts when the workspace is deleted", async () => {
    const member = await createWorkspaceMember();
    const craft = await createCraft(member.workspace.id, "Ops");

    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, member.workspace.id));

    const rows = await db
      .select()
      .from(schema.craftTable)
      .where(eq(schema.craftTable.id, craft.id));

    expect(rows).toHaveLength(0);
  });

  it("rejects a rename that collides with another craft in the workspace", async () => {
    const member = await createWorkspaceMember();
    const engineering = await createCraft(member.workspace.id, "Engineering");
    await createCraft(member.workspace.id, "Art");

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/craft/${engineering.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Art", color: "#3b82f6" }),
    });

    expect(response.status).toBe(409);
  });

  it("renames a craft and surfaces the new name on the board", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const craft = await createCraft(member.workspace.id, "Art", "#f43f5e");
    await createTask(project.project.id, craft.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const renamed = await app.request(`/api/craft/${craft.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Art Direction", color: "#f43f5e" }),
    });
    expect(renamed.status).toBe(200);

    const board = await app.request(`/api/task/tasks/${project.project.id}`);
    expect(board.status).toBe(200);
    const payload = (await board.json()) as {
      data: {
        columns: Array<{
          tasks: Array<{ craft: { id: string; name: string } | null }>;
        }>;
      };
    };

    const tasks = payload.data.columns.flatMap((column) => column.tasks);
    const crafted = tasks.find((task) => task.craft !== null);
    expect(crafted?.craft).toMatchObject({
      id: craft.id,
      name: "Art Direction",
      color: "#f43f5e",
    });
  });

  it("reports no craft on the board for an uncrafted task", async () => {
    const member = await createWorkspaceMember();
    const project = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await createTask(project.project.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const board = await app.request(`/api/task/tasks/${project.project.id}`);
    const payload = (await board.json()) as {
      data: { columns: Array<{ tasks: Array<{ craft: unknown }> }> };
    };

    const tasks = payload.data.columns.flatMap((column) => column.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.craft).toBeNull();
  });
});
