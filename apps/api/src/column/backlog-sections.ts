import type { BacklogSystemKey } from "../database/schema";

/**
 * Planned always leads the backlog and Archived always closes it, with custom
 * sections between them in position order. Pinning the ends here means no
 * reorder can bury the inbox or put live sections below the archive.
 */
export function orderBacklogSections<
  T extends { position: number; systemKey: BacklogSystemKey | null },
>(sections: T[]): T[] {
  const rank = (section: T) =>
    section.systemKey === "planned"
      ? 0
      : section.systemKey === "archived"
        ? 2
        : 1;

  return [...sections].sort(
    (a, b) => rank(a) - rank(b) || a.position - b.position,
  );
}
