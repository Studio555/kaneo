CREATE TABLE "craft" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "craft_id" text;--> statement-breakpoint
ALTER TABLE "craft" ADD CONSTRAINT "craft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "craft_workspace_id_idx" ON "craft" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "craft_workspace_name_unique" ON "craft" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_craft_id_craft_id_fk" FOREIGN KEY ("craft_id") REFERENCES "public"."craft"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_craftId_idx" ON "task" USING btree ("craft_id");