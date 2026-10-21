import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";
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
      });
    });

    it("resolves a renamed handle by numeric id and refreshes the cache", async () => {
      // The numeric id is the identity, so a GitHub rename still resolves,
      // and the stale handle must not be left behind for outbound assignment.
      const { user } = await createWorkspaceMember();
      await seedGithubAccount(user.id, "4242");
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
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
    it("routes GitHub events only to a connected account", async () => {
      const { user } = await createWorkspaceMember();
      await seedGithubAccount(user.id, "4242");

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBe(user.id);
    });

    it("stops routing as soon as the account is disconnected", async () => {
      // Disconnecting removes the Better Auth account row. Our cached handle
      // may still be around, and must not keep the door open.
      const { user } = await createWorkspaceMember();
      await seedGithubAccount(user.id, "4242");
      await getUserIdForGithubUser({ id: 4242, login: "ada" });

      await db
        .delete(schema.accountTable)
        .where(eq(schema.accountTable.userId, user.id));

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBeNull();
    });

    it("ignores a cached handle that no account row backs", async () => {
      const { user } = await createWorkspaceMember();
      await db.insert(schema.userGithubIdentityTable).values({
        userId: user.id,
        githubUserId: "4242",
        githubLogin: "ada",
      });

      await expect(
        getUserIdForGithubUser({ id: 4242, login: "ada" }),
      ).resolves.toBeNull();
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
        identity: { githubUserId: "4242", githubLogin: "ada" },
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

    it("requires authentication", async () => {
      const { app } = createApp();
      const response = await app.request("/api/user/github-identity");
      expect(response.status).toBe(401);
    });
  });
});
