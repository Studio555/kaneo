import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

describe("API integration: Slack app integration settings", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("stores the agent settings and keeps them across partial updates", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const path = `/api/slack-app-integration/project/${project.id}`;
    const request = (method: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const created = await request("POST", {
      agentEmoji: ":robot_fix:",
      maintainerSlackUserId: "U0AKCQBB1B3",
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      emoji: "kaneo",
      agentEmoji: "robot_fix",
      maintainerSlackUserId: "U0AKCQBB1B3",
    });

    const renamed = await request("PATCH", { emoji: "ticket" });
    expect(await renamed.json()).toMatchObject({
      emoji: "ticket",
      agentEmoji: "robot_fix",
      maintainerSlackUserId: "U0AKCQBB1B3",
    });

    const cleared = await request("PATCH", { agentEmoji: "" });
    expect(await cleared.json()).toMatchObject({
      emoji: "ticket",
      agentEmoji: null,
    });

    expect((await request("PATCH", { agentEmoji: "ticket" })).status).toBe(400);
  });
});
