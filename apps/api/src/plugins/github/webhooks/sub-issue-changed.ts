import { applySubIssueChangeToKaneo } from "../services/issue-hierarchy";

type Repository = { owner: { login: string }; name: string };

/**
 * GitHub reports one sub-issue change twice: `sub_issue_*` to the parent's
 * repository and `parent_issue_*` to the child's. Either one is enough, and
 * the second finds Kaneo already in agreement.
 */
export type SubIssueChangedPayload = {
  action:
    | "sub_issue_added"
    | "sub_issue_removed"
    | "parent_issue_added"
    | "parent_issue_removed";
  parent_issue: { number: number };
  sub_issue: { number: number };
  parent_issue_repo?: Repository;
  sub_issue_repo?: Repository;
  repository?: Repository;
};

export async function handleSubIssueChanged(payload: SubIssueChangedPayload) {
  const parentRepo = payload.parent_issue_repo ?? payload.repository;
  const childRepo = payload.sub_issue_repo ?? payload.repository;
  if (!parentRepo || !childRepo) {
    console.warn(
      `[GitHub Webhook] sub_issues.${payload.action} without repositories, skipping`,
    );
    return;
  }

  const change = payload.action.endsWith("_added") ? "added" : "removed";

  await applySubIssueChangeToKaneo(
    {
      owner: parentRepo.owner.login,
      repo: parentRepo.name,
      number: payload.parent_issue.number,
    },
    {
      owner: childRepo.owner.login,
      repo: childRepo.name,
      number: payload.sub_issue.number,
    },
    change,
  );
}
