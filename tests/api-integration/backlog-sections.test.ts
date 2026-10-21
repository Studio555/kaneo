import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Column = {
  id: string;
  slug: string;
  kind: string;
  systemKey: string | null;
};

type Board = {
  data: {
    columns: Array<{ slug: string }>;
    backlogSections: Array<{
      slug: string;
      systemKey: string | null;
      tasks: Array<{ id: string }>;
    }>;
    plannedTasks: Array<{ id: string }>;
  };
};

async function setup(role = "admin") {
  const member = await createWorkspaceMember({ role });
  const fixture = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();

  const json = (method: string, body?: unknown) => ({
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const createSection = async (name: string) => {
    const response = await app.request(
      `/api/column/${fixture.project.id}`,
      json("POST", { name, kind: "backlog" }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Column;
  };

  const createTask = async (status: string) => {
    const response = await app.request(
      `/api/task/${fixture.project.id}`,
      json("POST", {
        title: `Task in ${status}`,
        description: "",
        priority: "low",
        status,
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string; columnId: string | null };
  };

  const getBoard = async () => {
    const response = await app.request(`/api/task/tasks/${fixture.project.id}`);
    expect(response.status).toBe(200);
    return (await response.json()) as Board;
  };

  return { app, json, fixture, createSection, createTask, getBoard };
}

describe("API integration: backlog sections", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses section creation without project:update", async () => {
    const { app, json, fixture } = await setup("member");

    const response = await app.request(
      `/api/column/${fixture.project.id}`,
      json("POST", { name: "Icebox", kind: "backlog" }),
    );

    expect(response.status).toBe(403);
  });

  it("creates a section that holds tasks and shows between planned and archived", async () => {
    const { createSection, createTask, getBoard } = await setup();

    const icebox = await createSection("Icebox");
    expect(icebox).toMatchObject({
      slug: "icebox",
      kind: "backlog",
      systemKey: null,
    });

    const task = await createTask("icebox");
    expect(task.columnId).toBe(icebox.id);

    const board = await getBoard();
    expect(board.data.backlogSections.map((section) => section.slug)).toEqual([
      "planned",
      "icebox",
      "archived",
    ]);
    expect(
      board.data.backlogSections
        .find((section) => section.slug === "icebox")
        ?.tasks.map(({ id }) => id),
    ).toEqual([task.id]);
    expect(board.data.columns.map((column) => column.slug)).not.toContain(
      "icebox",
    );
  });

  it("keeps sections out of the default column listing", async () => {
    const { app, fixture, createSection } = await setup();
    await createSection("Icebox");

    const board = await app.request(`/api/column/${fixture.project.id}`);
    const backlog = await app.request(
      `/api/column/${fixture.project.id}?kind=backlog`,
    );

    const boardSlugs = ((await board.json()) as Column[]).map((c) => c.slug);
    const backlogSlugs = ((await backlog.json()) as Column[]).map(
      (c) => c.slug,
    );

    expect(boardSlugs).toEqual(["to-do", "in-progress", "in-review", "done"]);
    expect(backlogSlugs.sort()).toEqual(["archived", "icebox", "planned"]);
  });

  it("gives planned tasks their section's column id", async () => {
    const { fixture, createTask, getBoard } = await setup();

    const task = await createTask("planned");
    expect(task.columnId).toBe(fixture.backlogSections.planned.id);

    const board = await getBoard();
    expect(board.data.plannedTasks.map(({ id }) => id)).toEqual([task.id]);
  });

  it("refuses to delete, rename, or finalize the built-in sections", async () => {
    const { app, json, fixture } = await setup();
    const { planned, archived } = fixture.backlogSections;

    const deleted = await app.request(
      `/api/column/${archived.id}`,
      json("DELETE"),
    );
    const renamed = await app.request(
      `/api/column/${planned.id}`,
      json("PUT", { name: "Inbox" }),
    );
    const finalized = await app.request(
      `/api/column/${planned.id}`,
      json("PUT", { isFinal: true }),
    );

    expect(deleted.status).toBe(409);
    expect(renamed.status).toBe(400);
    expect(finalized.status).toBe(400);
  });

  it("suffixes a section slug that is taken by a board column", async () => {
    const { createSection } = await setup();

    const section = await createSection("Done");

    expect(section.slug).toBe("done-2");
    expect(section.kind).toBe("backlog");
  });

  it("deletes a custom section only once it is empty", async () => {
    const { app, json, createSection, createTask } = await setup();
    const icebox = await createSection("Icebox");
    const task = await createTask("icebox");

    const refused = await app.request(
      `/api/column/${icebox.id}`,
      json("DELETE"),
    );
    expect(refused.status).toBe(409);

    const moved = await app.request(
      `/api/task/status/${task.id}`,
      json("PUT", { status: "planned" }),
    );
    expect(moved.status).toBe(200);

    const deleted = await app.request(
      `/api/column/${icebox.id}`,
      json("DELETE"),
    );
    expect(deleted.status).toBe(200);
  });
});
