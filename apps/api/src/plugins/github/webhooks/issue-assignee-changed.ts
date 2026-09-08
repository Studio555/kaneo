import { publishEvent } from "../../../events";
import { findExternalLink, updateExternalLink } from "../services/link-manager";
import {
  findAllIntegrationsByRepo,
  findTaskById,
  updateTaskAssignee,
} from "../services/task-service";
import { getUserIdForGithubUser } from "../services/user-link";
import {
  parseIssueUpdatedAtMs,
  shouldSkipInboundAssigneeSync,
} from "../utils/outbound-echo";
import { parseLinkMetadata } from "../utils/parse-link-metadata";

type IssueAssigneeChangedPayload = {
  action: string;
  issue: {
    number: number;
    updated_at?: string;
  };
  assignee: {
    id: number;
    login: string;
  } | null;
  repository: {
    owner: { login: string };
    name: string;
  };
};

export async function handleIssueAssigneeChanged(
  payload: IssueAssigneeChangedPayload,
) {
  const { action, issue, assignee, repository } = payload;

  if (!assignee || assignee.login.endsWith("[bot]")) {
    return;
  }

  const unassigning = action === "unassigned";

  const integrations = await findAllIntegrationsByRepo(
    repository.owner.login,
    repository.name,
  );

  for (const integration of integrations) {
    const externalLink = await findExternalLink(
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!externalLink) {
      continue;
    }

    const existingMetadata = parseLinkMetadata(externalLink.metadata, {
      externalLinkId: externalLink.id,
      source: `issue_${action}`,
    });

    if (
      shouldSkipInboundAssigneeSync(
        existingMetadata,
        issue,
        unassigning ? null : assignee.login,
      )
    ) {
      continue;
    }

    // GitHub retries and can deliver out of order, so an event older than the
    // last one applied describes assignee state already superseded. Applying
    // it would leave Kaneo naming somebody GitHub has moved off.
    const eventMs = parseIssueUpdatedAtMs(issue);
    const lastInbound = existingMetadata.lastInboundAssigneeEventAt;
    if (
      eventMs !== null &&
      typeof lastInbound === "number" &&
      eventMs < lastInbound
    ) {
      continue;
    }

    const task = await findTaskById(externalLink.taskId);
    if (!task) {
      continue;
    }

    const mappedUserId = await getUserIdForGithubUser(assignee);
    if (!mappedUserId) {
      continue;
    }

    // Unassigning on GitHub only clears Kaneo when the person who left is the
    // one Kaneo has. A stale delivery, or a co-assignee being removed, must
    // not wipe an assignment that is still correct.
    if (unassigning && task.userId !== mappedUserId) {
      continue;
    }

    const result = await updateTaskAssignee(
      task.id,
      unassigning ? null : mappedUserId,
    );

    if (!result.applied) {
      continue;
    }

    if (eventMs !== null) {
      await updateExternalLink(externalLink.id, {
        metadata: { ...existingMetadata, lastInboundAssigneeEventAt: eventMs },
      });
    }

    if (unassigning) {
      await publishEvent("task.unassigned", {
        taskId: result.after.id,
        projectId: result.after.projectId,
        userId: null,
        title: result.after.title,
        type: "unassigned",
      });
      continue;
    }

    await publishEvent("task.assignee_changed", {
      taskId: result.after.id,
      projectId: result.after.projectId,
      userId: null,
      oldAssignee: result.before.userId,
      newAssignee: result.assigneeName,
      newAssigneeId: mappedUserId,
      title: result.after.title,
      type: "assignee_changed",
    });
  }
}
