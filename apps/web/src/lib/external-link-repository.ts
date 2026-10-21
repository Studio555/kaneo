type RepositoryLink = {
  url: string;
  metadata: Record<string, unknown> | null | undefined;
};

/**
 * The `owner/name` of the repository a link points into. Pull requests may
 * come from any repository, so the name is needed to tell them apart. Newer
 * links record it in their metadata; older ones only have the URL.
 */
export function getLinkRepository(link: RepositoryLink): string | null {
  const recorded = link.metadata?.repository;
  if (typeof recorded === "string" && recorded.length > 0) {
    return recorded;
  }

  const match = link.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/);
  return match?.[1] ?? null;
}

export function getLinkRepositoryName(link: RepositoryLink): string | null {
  const repository = getLinkRepository(link);
  if (!repository) return null;
  return repository.slice(repository.indexOf("/") + 1);
}
