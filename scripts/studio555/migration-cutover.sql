-- One-off, run against the production database right before the first deploy
-- built from the upstream-aligned fork (after taking a backup).
--
-- The old fork applied its own migrations 0045-0050 (craft, GitHub identities,
-- Slack/agent-run links, backlog sections). Upstream later shipped different
-- migrations under the same numbers, and Drizzle only applies migrations newer
-- than the last recorded one, so with these rows present it would silently skip
-- upstream 0045-0058. Forgetting them lets upstream 0045-0063 run; the fork's
-- schema is then re-asserted by the idempotent 0064_s555_fork_features.
BEGIN;
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at IN (
	1788862704084, -- 0045_early_klaw
	1788900854654, -- 0046_crazy_salo
	1788942438769, -- 0047_foamy_mother_askani
	1789996580870, -- 0048_youthful_tag
	1790240855116, -- 0049_backlog_sections
	1790929869915  -- 0050_agent_run_unique
);
-- Expect 6 rows deleted and the latest remaining entry to be 0044 (1787492852776).
SELECT max(created_at) AS last_applied FROM drizzle.__drizzle_migrations;
COMMIT;
