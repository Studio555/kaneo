import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { updateTaskAssignee } from "../../apps/api/src/plugins/github/services/task-service";
import {
  getGithubLoginForUser,
  getUserIdForGithubUser,
} from "../../apps/api/src/plugins/github/services/user-link";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function seedTask(projectId: string, assigneeId: string | null) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      userId: assigneeId,
      title: "Seed",
      status: "to-do",
      priority: "medium",
      number: 1,
      position: 1,
    })
    .returning();
  return task;
}

async function seedGithubAccount(userId: string, githubUserId: string) {
  await db.insert(schema.accountTable).values({
    accountId: githubUserId,
    providerId: "github",
    userId,
  });
}

describe("API integration: GitHub user linking", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("identity resolution", () => {
    it("seeds the identity from a GitHub SSO account row", async () => {
      const { user } = await createWorkspaceMember();
      await seedGithubAccount(user.id, "4242");

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBe(user.id);

      const stored = await db.query.userGithubIdentityTable.findFirst({
        where: eq(schema.userGithubIdentityTable.userId, user.id),
      });
      expect(stored).toMatchObject({
        githubUserId: "4242",
        githubLogin: "ada",
        verified: true,
      });
    });

    it("resolves a renamed handle by numeric id and refreshes the cache", async () => {
      const { user } = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
        verified: true,
      });

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada-lovelace" }),
      ).resolves.toBe(user.id);

      const stored = await db.query.userGithubIdentityTable.findFirst({
        where: eq(schema.userGithubIdentityTable.userId, user.id),
      });
      expect(stored?.githubLogin).toBe("ada-lovelace");
    });

    it("returns the stored login without calling GitHub", async () => {
      const { user } = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      const octokit = {
        request: async () => {
          throw new Error("should not be called");
        },
      };

      await expect(
        getGithubLoginForUser(user.id, octokit as never),
      ).resolves.toBe("ada");
    });

    it("refuses to link one GitHub account to two Kaneo users", async () => {
      const first = await createWorkspaceMember();
      const second = await createWorkspaceMember();

      await db.insert(schema.userGithubIdentityTable).values({
        userId: first.user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      await expect(
        db.insert(schema.userGithubIdentityTable).values({
          userId: second.user.id,
          githubUserId: "4242",
          githubLogin: "ada",
        }),
      ).rejects.toThrow();
    });

    it("removes the identity when the user is deleted", async () => {
      const { user } = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      await db.delete(schema.userTable).where(eq(schema.userTable.id, user.id));

      const rows = await db.select().from(schema.userGithubIdentityTable);
      expect(rows).toHaveLength(0);
    });
  });

  describe("inbound authority", () => {
    it("does not route GitHub events to an unverified claim", async () => {
      // Somebody typing another person's handle must not receive that
      // person's task assignments.
      const impostor = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: impostor.user.id,
        githubUserId: "4242",
        githubLogin: "ada",
        verified: false,
      });

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBeNull();
    });

    it("lets GitHub SSO take over an unverified claim on the same account", async () => {
      const impostor = await createWorkspaceMember();
      const owner = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: impostor.user.id,
        githubUserId: "4242",
        githubLogin: "ada",
        verified: false,
      });
      await seedGithubAccount(owner.user.id, "4242");

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBe(owner.user.id);

      const rows = await db.select().from(schema.userGithubIdentityTable);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.user.id,
        verified: true,
      });
    });

    it("defaults a stored link to unverified", async () => {
      const { user } = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      const stored = await db.query.userGithubIdentityTable.findFirst({
        where: eq(schema.userGithubIdentityTable.userId, user.id),
      });
      expect(stored?.verified).toBe(false);
    });
  });

  describe("inbound assignment", () => {
    it("assigns a workspace member", async () => {
      const { user, workspace } = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const task = await seedTask(project.id, null);

      const result = await updateTaskAssignee(task.id, user.id);

      expect(result.applied).toBe(true);
      const stored = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(stored?.userId).toBe(user.id);
    });

    it("refuses somebody who is not a member of the project's workspace", async () => {
      // The workspace boundary has to hold even though the request came from
      // GitHub rather than through the API.
      const owner = await createWorkspaceMember();
      const outsider = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: owner.workspace.id,
      });
      const task = await seedTask(project.id, null);

      const result = await updateTaskAssignee(task.id, outsider.user.id);

      expect(result.applied).toBe(false);
      const stored = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(stored?.userId).toBeNull();
    });

    it("reports no change when the assignee already matches", async () => {
      const { user, workspace } = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const task = await seedTask(project.id, user.id);

      const result = await updateTaskAssignee(task.id, user.id);

      expect(result.applied).toBe(false);
    });

    it("clears the assignee and reports the change", async () => {
      const { user, workspace } = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const task = await seedTask(project.id, user.id);

      const result = await updateTaskAssignee(task.id, null);

      expect(result.applied).toBe(true);
      const stored = await db.query.taskTable.findFirst({
        where: eq(schema.taskTable.id, task.id),
      });
      expect(stored?.userId).toBeNull();
    });
  });

  describe("HTTP routes", () => {
    it("reports no link, then the link, then removes it", async () => {
      const { user } = await createWorkspaceMember();
      mockAuthenticatedSession(user as never);
      const { app } = createApp();

      const empty = await app.request("/api/user/github-identity");
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({ identity: null });

      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      const linked = await app.request("/api/user/github-identity");
      expect(await linked.json()).toEqual({
        identity: { githubUserId: "4242", githubLogin: "ada", verified: false },
      });

      const removed = await app.request("/api/user/github-identity", {
        method: "DELETE",
      });
      expect(removed.status).toBe(200);
      expect(
        await db.query.userGithubIdentityTable.findFirst({
          where: eq(schema.userGithubIdentityTable.userId, user.id),
        }),
      ).toBeUndefined();
    });

    it("rejects a malformed GitHub username before reaching GitHub", async () => {
      const { user } = await createWorkspaceMember();
      mockAuthenticatedSession(user as never);
      const { app } = createApp();

      const response = await app.request("/api/user/github-identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: "not a username" }),
      });

      expect(response.status).toBe(400);
    });

    it("reports the GitHub App being unconfigured rather than storing blind", async () => {
      // This instance has no GitHub App env, so verification is impossible and
      // storing an unverified handle would only fail later, invisibly.
      const { user } = await createWorkspaceMember();
      mockAuthenticatedSession(user as never);
      const { app } = createApp();

      const response = await app.request("/api/user/github-identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: `ada-${randomUUID().slice(0, 8)}` }),
      });

      expect(response.status).toBe(503);
    });

    it("requires authentication", async () => {
      const { app } = createApp();
      const response = await app.request("/api/user/github-identity");
      expect(response.status).toBe(401);
    });
  });
});
