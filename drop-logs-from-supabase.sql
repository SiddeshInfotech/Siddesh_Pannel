-- ============================================================================
-- AFTER the MongoDB move is verified: drop the Health/Logs tables + functions from Supabase.
-- Run manually in the Supabase SQL editor, ONLY when:
--   1. the panel with MongoDB storage is deployed and Health + Logs work, and
--   2. `node --env-file=.env scripts/migrate-logs-to-mongo.mjs` was re-run after the deploy
--      (counts match), so nothing written in between is lost.
-- This cannot be undone (no backups on the free tiers) — take a Supabase backup/export first.
--
-- KEPT on purpose (still used): bump_login_rate_limit / reset_login_rate_limit (admin login +
-- Logs rate limits), next_public_seq / public_id_counters (BUG-/CR-/INC- numbering),
-- ops_db_stats / ops_storage_stats (Infrastructure tab reports on Supabase itself),
-- and the `diagnostics` storage bucket (crash dump / screenshot FILES).
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS diag_artifacts, diag_crashes, diag_events, diag_audit, diag_cleanup_runs,
  diag_roles, diag_settings, diag_issues CASCADE;
DROP TABLE IF EXISTS ops_provider_metrics, ops_providers, ops_incidents, ops_alerts, ops_alert_rules,
  ops_releases, ops_costs, ops_settings, ops_rollups, ops_device_metrics, ops_activity_daily CASCADE;

DROP FUNCTION IF EXISTS diag_touch_issue CASCADE;
DROP FUNCTION IF EXISTS diag_storage_stats(text);
DROP FUNCTION IF EXISTS ops_event_series(text, timestamptz, timestamptz, int, text);
DROP FUNCTION IF EXISTS ops_percentiles(text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS ops_activity_refresh(text, int);
DROP SEQUENCE IF EXISTS diag_issue_seq, ops_incident_seq;

COMMIT;
