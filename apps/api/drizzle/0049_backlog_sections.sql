ALTER TABLE "column" ADD COLUMN "kind" text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE "column" ADD COLUMN "system_key" text;--> statement-breakpoint
-- Column creation has long refused the "planned" and "archived" slugs, but a
-- project that predates that guard may still hold one. Adopt it as the system
-- section instead of creating a second row with the same slug. A backlog
-- section is never a done state, so any final flag it carried goes.
UPDATE "column"
SET "kind" = 'backlog', "system_key" = "slug", "is_final" = false
WHERE "id" IN (
	SELECT DISTINCT ON ("project_id", "slug") "id"
	FROM "column"
	WHERE "slug" IN ('planned', 'archived')
	ORDER BY "project_id", "slug", "position", "created_at"
);--> statement-breakpoint
INSERT INTO "column" ("id", "project_id", "name", "slug", "position", "is_final", "kind", "system_key")
SELECT gen_random_uuid()::text, "project"."id", "section"."name", "section"."slug", "section"."position", false, 'backlog', "section"."slug"
FROM "project"
CROSS JOIN (VALUES ('Planned', 'planned', 0), ('Archived', 'archived', 1)) AS "section" ("name", "slug", "position")
WHERE NOT EXISTS (
	SELECT 1 FROM "column"
	WHERE "column"."project_id" = "project"."id"
		AND "column"."system_key" = "section"."slug"
);--> statement-breakpoint
UPDATE "task"
SET "column_id" = "column"."id"
FROM "column"
WHERE "column"."project_id" = "task"."project_id"
	AND "column"."system_key" = "task"."status"
	AND "task"."column_id" IS DISTINCT FROM "column"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "column_project_system_key_unique" ON "column" USING btree ("project_id","system_key") WHERE "column"."system_key" is not null;
