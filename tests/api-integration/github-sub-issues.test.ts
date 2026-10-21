import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import {
  handleTaskRelationCreated,
  handleTaskRelationDeleted,
} from "../../apps/api/src/plugins/github/events/task-relation-changed";
import { reconcileIssueHierarchy } from "../../apps/api/src/plugins/github/services/issue-hierarchy";
import { handleSubIssueChanged } from "../../apps/api/src/plugins/github/webhooks/sub-issue-changed";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const github = vi.hoisted(() => {
  const issues = {
    get: vi.fn(),
    addSubIssue: vi.fn(),
    removeSubIssue: vi.fn(),
    getParent: vi.fn(),
    listSubIssues: vi.fn(),
  };
  const octokit = {
    rest: { issues },
    paginate: vi.fn(),
  };
  return { issues, octokit };
});

vi.mock("../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => ({}),
  getVerifiedInstallationOctokit: async () => github.octokit,
}));

vi.mock("../../apps/api/src/events", () => ({
  publishEvent: vi.fn(),
}));

const OWNER = "Studio555";
const REPO = "s555-atlas";
const repository = { owner: { login: OWNER }, name: REPO };
const repositoryUrl = `https://api.github.com/repos/${OWNER}/${REPO}`;

/** GitHub's database id for an issue, distinct from its number as the real API is. */
const issueId = (number: number) => 9000 + number;

let taskNumber = 0;

async function seedProject() {
  const { workspace, user } = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const [integration] = await db
    .insert(schema.integrationTable)
    .values({
      projectId: project.id,
      type: "github",
      config: JSON.stringify({
        repositoryOwner: OWNER,
        repositoryName: REPO,
        installationId: 1,
        repositoryId: 2,
        verifiedGithubAccountId: "3",
        verifiedByUserId: user.id,
      }),
    })
    .returning();
  return { workspace, project, integration };
}

async function seedTask(
  projectId: string,
  integrationId: string,
  issueNumber: number | null,
) {
  taskNumber++;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Task ${taskNumber}`,
      status: "to-do",
      priority: "medium",
      number: taskNumber,
      position: taskNumber,
    })
    .returning();

  if (issueNumber !== null) {
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      integrationId,
      resourceType: "issue",
      externalId: issueNumber.toString(),
      url: `https://github.com/${OWNER}/${REPO}/issues/${issueNumber}`,
    });
  }
  return task;
}

async function subtaskRelations() {
  return db
    .select({
      sourceTaskId: schema.taskRelationTable.sourceTaskId,
      targetTaskId: schema.taskRelationTable.targetTaskId,
    })
    .from(schema.taskRelationTable)
    .where(eq(schema.taskRelationTable.relationType, "subtask"));
}

function subIssuePayload(
  action:
    | "sub_issue_added"
    | "sub_issue_removed"
    | "parent_issue_added"
    | "parent_issue_removed",
  parentNumber: number,
  childNumber: number,
) {
  const isSubIssueEvent = action.startsWith("sub_issue");
  return {
    action,
    parent_issue: { number: parentNumber },
    sub_issue: { number: childNumber },
    ...(isSubIssueEvent
      ? { sub_issue_repo: repository }
      : { parent_issue_repo: repository }),
    repository,
  };
}

describe("API integration: GitHub sub-issues mirror Kaneo subtasks", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.clearAllMocks();
    github.issues.get.mockImplementation(
      async ({ issue_number }: { issue_number: number }) => ({
        data: { id: issueId(issue_number), number: issue_number },
      }),
    );
    github.issues.addSubIssue.mockResolvedValue({ data: {} });
    github.issues.removeSubIssue.mockResolvedValue({ data: {} });
    github.issues.getParent.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    github.octokit.paginate.mockResolvedValue([]);
  });

  describe("GitHub to Kaneo", () => {
    it("records a sub-issue as a subtask, once for both deliveries", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);

      // GitHub sends the same change to the parent's and the child's repo.
      await handleSubIssueChanged(subIssuePayload("sub_issue_added", 10, 11));
      await handleSubIssueChanged(
        subIssuePayload("parent_issue_added", 10, 11),
      );

      expect(await subtaskRelations()).toEqual([
        { sourceTaskId: parent.id, targetTaskId: child.id },
      ]);
    });

    it("drops the subtask when the sub-issue is removed", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);
      await db.insert(schema.taskRelationTable).values({
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      });

      await handleSubIssueChanged(subIssuePayload("sub_issue_removed", 10, 11));
      await handleSubIssueChanged(
        subIssuePayload("parent_issue_removed", 10, 11),
      );

      expect(await subtaskRelations()).toEqual([]);
    });

    it("leaves Kaneo alone when an issue has no task", async () => {
      const { project, integration } = await seedProject();
      await seedTask(project.id, integration.id, 10);

      await handleSubIssueChanged(subIssuePayload("sub_issue_added", 10, 99));

      expect(await subtaskRelations()).toEqual([]);
    });

    it("never relates tasks across workspaces", async () => {
      // Two workspaces each connect the same repository.
      const first = await seedProject();
      const second = await seedProject();
      const firstParent = await seedTask(
        first.project.id,
        first.integration.id,
        10,
      );
      const firstChild = await seedTask(
        first.project.id,
        first.integration.id,
        11,
      );
      const secondParent = await seedTask(
        second.project.id,
        second.integration.id,
        10,
      );
      const secondChild = await seedTask(
        second.project.id,
        second.integration.id,
        11,
      );

      await handleSubIssueChanged(subIssuePayload("sub_issue_added", 10, 11));

      const relations = await subtaskRelations();
      expect(relations).toHaveLength(2);
      expect(relations).toEqual(
        expect.arrayContaining([
          { sourceTaskId: firstParent.id, targetTaskId: firstChild.id },
          { sourceTaskId: secondParent.id, targetTaskId: secondChild.id },
        ]),
      );
    });
  });

  describe("Kaneo to GitHub", () => {
    it("adds the child's issue under the parent's, taking it from any old parent", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);

      await handleTaskRelationCreated(
        {
          sourceTaskId: parent.id,
          targetTaskId: child.id,
          relationType: "subtask",
          projectId: project.id,
          userId: null,
        },
        { integrationId: integration.id, projectId: project.id, config: {} },
      );

      expect(github.issues.addSubIssue).toHaveBeenCalledWith({
        owner: OWNER,
        repo: REPO,
        issue_number: 10,
        sub_issue_id: issueId(11),
        replace_parent: true,
      });
    });

    it("does not echo a relation that came from GitHub, or touch other relation types", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);
      const context = {
        integrationId: integration.id,
        projectId: project.id,
        config: {},
      };
      const base = {
        sourceTaskId: parent.id,
        targetTaskId: child.id,
        projectId: project.id,
        userId: null,
      };

      await handleTaskRelationCreated(
        { ...base, relationType: "subtask", origin: "github" },
        context,
      );
      await handleTaskRelationCreated(
        { ...base, relationType: "blocks" },
        context,
      );
      await handleTaskRelationDeleted(
        { ...base, relationType: "subtask", origin: "github" },
        context,
      );

      expect(github.issues.addSubIssue).not.toHaveBeenCalled();
      expect(github.issues.removeSubIssue).not.toHaveBeenCalled();
    });

    it("waits for both tasks to have issues", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const backlogChild = await seedTask(project.id, integration.id, null);

      await handleTaskRelationCreated(
        {
          sourceTaskId: parent.id,
          targetTaskId: backlogChild.id,
          relationType: "subtask",
          projectId: project.id,
          userId: null,
        },
        { integrationId: integration.id, projectId: project.id, config: {} },
      );

      expect(github.issues.addSubIssue).not.toHaveBeenCalled();
    });

    it("removes the sub-issue when the subtask relation is deleted", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);

      await handleTaskRelationDeleted(
        {
          sourceTaskId: parent.id,
          targetTaskId: child.id,
          relationType: "subtask",
          projectId: project.id,
          userId: null,
        },
        { integrationId: integration.id, projectId: project.id, config: {} },
      );

      expect(github.issues.removeSubIssue).toHaveBeenCalledWith({
        owner: OWNER,
        repo: REPO,
        issue_number: 10,
        sub_issue_id: issueId(11),
      });
    });

    it("swallows GitHub refusing a sub-issue it already has", async () => {
      const { project, integration } = await seedProject();
      const parent = await seedTask(project.id, integration.id, 10);
      const child = await seedTask(project.id, integration.id, 11);
      github.issues.addSubIssue.mockRejectedValue(
        Object.assign(new Error("Validation Failed"), { status: 422 }),
      );

      await expect(
        handleTaskRelationCreated(
          {
            sourceTaskId: parent.id,
            targetTaskId: child.id,
            relationType: "subtask",
            projectId: project.id,
            userId: null,
          },
          { integrationId: integration.id, projectId: project.id, config: {} },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("reconciling a newly linked issue", () => {
    it("pulls GitHub's parent and sub-issues and pushes Kaneo's subtasks", async () => {
      const { project, integration } = await seedProject();
      const githubParent = await seedTask(project.id, integration.id, 10);
      const githubChild = await seedTask(project.id, integration.id, 11);
      const task = await seedTask(project.id, integration.id, 12);
      const kaneoChild = await seedTask(project.id, integration.id, 13);
      await db.insert(schema.taskRelationTable).values({
        sourceTaskId: task.id,
        targetTaskId: kaneoChild.id,
        relationType: "subtask",
      });

      github.issues.getParent.mockResolvedValue({
        data: { number: 10, repository_url: repositoryUrl },
      });
      github.octokit.paginate.mockResolvedValue([
        { number: 11, repository_url: repositoryUrl },
      ]);

      await reconcileIssueHierarchy(task.id);

      const relations = await subtaskRelations();
      expect(relations).toEqual(
        expect.arrayContaining([
          { sourceTaskId: githubParent.id, targetTaskId: task.id },
          { sourceTaskId: task.id, targetTaskId: githubChild.id },
          { sourceTaskId: task.id, targetTaskId: kaneoChild.id },
        ]),
      );
      expect(relations).toHaveLength(3);

      // Reconciling never takes an issue away from a parent GitHub gave it.
      expect(github.issues.addSubIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 12,
          sub_issue_id: issueId(13),
          replace_parent: false,
        }),
      );
      for (const call of github.issues.addSubIssue.mock.calls) {
        expect(call[0].replace_parent).toBe(false);
      }
    });

    it("does nothing for a task without an issue", async () => {
      const { project, integration } = await seedProject();
      const task = await seedTask(project.id, integration.id, null);

      await reconcileIssueHierarchy(task.id);

      expect(github.issues.getParent).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(schema.taskRelationTable)
          .where(and(eq(schema.taskRelationTable.sourceTaskId, task.id))),
      ).toEqual([]);
    });
  });
});
