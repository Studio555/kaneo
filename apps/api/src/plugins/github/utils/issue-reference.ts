/**
 * Finds references to issues in one specific repository, so a pull request
 * opened anywhere can name the issue it belongs to (`owner/repo#12`, or the
 * issue URL). A bare `#12` is deliberately not accepted: on GitHub it means
 * an issue in the pull request's own repository, which is not the one asked
 * for here.
 */

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatterns(owner: string, repo: string): RegExp[] {
  const fullName = `${escapeRegex(owner)}/${escapeRegex(repo)}`;
  return [
    // The lookbehind rejects `github.com/owner/repo#12` (a URL fragment) and
    // prefixes such as `xowner/repo#12`; the `#` directly after the repo name
    // rejects `owner/repo-foo#12` and `owner/repo.git#12`.
    new RegExp(`(?<![\\w/.-])${fullName}#(\\d+)(?!\\d)`, "gi"),
    new RegExp(
      `(?<![\\w@.-])(?:https?://)?(?:www\\.)?github\\.com/${fullName}/issues/(\\d+)(?!\\d)`,
      "gi",
    ),
  ];
}

export function extractIssueReferences(
  text: string | null | undefined,
  owner: string,
  repo: string,
): number[] {
  if (!text) {
    return [];
  }

  const numbers: number[] = [];
  for (const pattern of buildPatterns(owner, repo)) {
    for (const match of text.matchAll(pattern)) {
      const digits = match[1];
      if (!digits) continue;
      const number = Number.parseInt(digits, 10);
      if (number > 0 && !numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }

  return numbers;
}

export function extractIssueReferencesFromPullRequest(
  pullRequest: {
    branch: string;
    title: string;
    body: string | null | undefined;
  },
  owner: string,
  repo: string,
): number[] {
  const numbers: number[] = [];
  for (const text of [
    pullRequest.branch,
    pullRequest.title,
    pullRequest.body,
  ]) {
    for (const number of extractIssueReferences(text, owner, repo)) {
      if (!numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }
  return numbers;
}
