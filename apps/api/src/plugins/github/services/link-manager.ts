import { and, eq } from "drizzle-orm";
import db from "../../../database";
import { externalLinkTable } from "../../../database/schema";
import { parseLinkMetadata } from "../utils/parse-link-metadata";
import { sameRepository } from "../utils/repository";

export type CreateExternalLinkParams = {
  taskId: string;
  integrationId: string;
  resourceType: "issue" | "pull_request" | "branch";
  externalId: string;
  url: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
};

export type PullRequestLinkMetadata = {
  state?: string;
  draft?: boolean;
  merged?: boolean;
  mergedAt?: string | null;
  branch?: string;
  author?: string;
  /**
   * `owner/name` of the repository the pull request lives in. Absent on rows
   * written before pull requests from other repositories could be linked;
   * those can only have come from the integration's own repository.
   */
  repository?: string;
};

export type UpdateExternalLinkParams = {
  title?: string | null;
  url?: string;
  metadata?: Record<string, unknown>;
};

export async function createExternalLink(
  params: CreateExternalLinkParams,
): Promise<{ id: string }> {
  const result = await db
    .insert(externalLinkTable)
    .values({
      taskId: params.taskId,
      integrationId: params.integrationId,
      resourceType: params.resourceType,
      externalId: params.externalId,
      url: params.url,
      title: params.title ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    })
    .returning({ id: externalLinkTable.id });

  const link = result[0];
  if (!link) {
    throw new Error("Failed to create external link");
  }

  return link;
}

export async function findExternalLink(
  integrationId: string,
  resourceType: string,
  externalId: string,
) {
  return db.query.externalLinkTable.findFirst({
    where: and(
      eq(externalLinkTable.integrationId, integrationId),
      eq(externalLinkTable.resourceType, resourceType),
      eq(externalLinkTable.externalId, externalId),
    ),
  });
}

/**
 * The links for one pull request. A pull request number is only unique within
 * its repository, and one integration now sees pull requests from many, so the
 * bare `externalId` is not enough on its own. Returns every match because one
 * pull request may be linked to several tasks.
 */
export async function findPullRequestLinks(
  integrationId: string,
  pullRequestNumber: number,
  repositoryFullName: string,
  integrationRepositoryFullName: string,
) {
  const candidates = await db.query.externalLinkTable.findMany({
    where: and(
      eq(externalLinkTable.integrationId, integrationId),
      eq(externalLinkTable.resourceType, "pull_request"),
      eq(externalLinkTable.externalId, pullRequestNumber.toString()),
    ),
  });

  return candidates.filter((link) => {
    const metadata = parseLinkMetadata<PullRequestLinkMetadata>(link.metadata, {
      externalLinkId: link.id,
      source: "find_pull_request_links",
    });
    return sameRepository(
      metadata.repository ?? integrationRepositoryFullName,
      repositoryFullName,
    );
  });
}

export async function findExternalLinkByTaskAndType(
  taskId: string,
  integrationId: string,
  resourceType: string,
) {
  return db.query.externalLinkTable.findFirst({
    where: and(
      eq(externalLinkTable.taskId, taskId),
      eq(externalLinkTable.integrationId, integrationId),
      eq(externalLinkTable.resourceType, resourceType),
    ),
  });
}

export async function findExternalLinksByTask(taskId: string) {
  return db.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.taskId, taskId),
    with: {
      integration: true,
    },
  });
}

export async function updateExternalLink(
  id: string,
  params: UpdateExternalLinkParams,
) {
  const updateData: Record<string, unknown> = {};

  if (params.title !== undefined) {
    updateData.title = params.title;
  }
  if (params.url !== undefined) {
    updateData.url = params.url;
  }
  if (params.metadata !== undefined) {
    updateData.metadata = JSON.stringify(params.metadata);
  }

  if (Object.keys(updateData).length === 0) {
    return;
  }

  await db
    .update(externalLinkTable)
    .set(updateData)
    .where(eq(externalLinkTable.id, id));
}

export async function createOrUpdateExternalLink(
  params: CreateExternalLinkParams,
): Promise<{ id: string; created: boolean }> {
  const existing = await findExternalLink(
    params.integrationId,
    params.resourceType,
    params.externalId,
  );

  if (existing) {
    await updateExternalLink(existing.id, {
      title: params.title,
      url: params.url,
      metadata: params.metadata,
    });
    return { id: existing.id, created: false };
  }

  const link = await createExternalLink(params);
  return { id: link.id, created: true };
}

export async function deleteExternalLink(id: string) {
  await db.delete(externalLinkTable).where(eq(externalLinkTable.id, id));
}

export async function getExternalLinksByIntegration(integrationId: string) {
  return db.query.externalLinkTable.findMany({
    where: eq(externalLinkTable.integrationId, integrationId),
  });
}
