-- Studio555 fork features (craft, GitHub identities, backlog sections, Slack and
-- agent-run links). Production applied these as s555 migrations 0045-0050 before
-- the fork was rebased onto upstream, so every statement is idempotent: on that
-- database this migration is a no-op, elsewhere it creates the schema.
CREATE TABLE IF NOT EXISTS "craft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_github_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"github_user_id" text NOT NULL,
	"github_login" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_github_identity_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_github_identity_github_user_id_unique" UNIQUE("github_user_id")
);
--> statement-breakpoint
ALTER TABLE "column" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'board' NOT NULL;--> statement-breakpoint
ALTER TABLE "column" ADD COLUMN IF NOT EXISTS "system_key" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "craft_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "craft" ADD CONSTRAINT "craft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_github_identity" ADD CONSTRAINT "user_github_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "task" ADD CONSTRAINT "task_craft_id_craft_id_fk" FOREIGN KEY ("craft_id") REFERENCES "public"."craft"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "craft_workspace_id_idx" ON "craft" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "craft_workspace_name_unique" ON "craft" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_craftId_idx" ON "task" USING btree ("craft_id");--> statement-breakpoint
-- Adopt a legacy "planned"/"archived" column as the project's system backlog
-- section rather than creating a second row with the same slug.
UPDATE "column"
SET "kind" = 'backlog', "system_key" = "slug", "is_final" = false
WHERE "id" IN (
	SELECT DISTINCT ON ("project_id", "slug") "id"
	FROM "column" AS "legacy"
	WHERE "slug" IN ('planned', 'archived')
		AND NOT EXISTS (
			SELECT 1 FROM "column"
			WHERE "column"."project_id" = "legacy"."project_id"
				AND "column"."system_key" = "legacy"."slug"
		)
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
CREATE UNIQUE INDEX IF NOT EXISTS "column_project_system_key_unique" ON "column" USING btree ("project_id","system_key") WHERE "column"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_link_slack_message_unique" ON "external_link" USING btree ("integration_id","external_id") WHERE "external_link"."resource_type" = 'slack_message';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_link_agent_run_unique" ON "external_link" USING btree ("integration_id","external_id") WHERE "external_link"."resource_type" = 'agent_run';
