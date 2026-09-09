-- Links are now made only through the GitHub OAuth flow, so every remaining
-- row is proven by a Better Auth account row. Rows that were created by
-- typing a username are not, and dropping the column would silently promote
-- them to proven, letting somebody receive assignments for a GitHub account
-- they merely named. They are removed rather than carried over; anybody
-- affected reconnects from Settings in one click.
DELETE FROM "user_github_identity" WHERE "verified" = false;--> statement-breakpoint
ALTER TABLE "user_github_identity" DROP COLUMN "verified";