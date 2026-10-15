-- ============================================================================
-- Operations Center — long-term Activity history (Health → Overview → Activity).
-- Run ONCE in the Supabase SQL editor AFTER ops-schema.sql. Safe to re-run.
--
-- Raw diag_events expire after hours/days, so the Activity chart could never show more than
-- a few days. This keeps ONE compact row per panel, UTC day and product (+ an '_all' row):
-- integer counters only, no text payloads. 3 years ≈ 1,100 days × (products + 1) rows —
-- well under 1 MB per panel. Retention: Settings → "Daily summaries (days)", minimum 3 years.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ops_activity_daily (
  panel        text     NOT NULL,
  day          date     NOT NULL,                 -- UTC calendar day
  product_id   text     NOT NULL DEFAULT '_all',  -- '_all' = every product of the panel
  events       integer  NOT NULL DEFAULT 0,
  errors       integer  NOT NULL DEFAULT 0,
  warnings     integer  NOT NULL DEFAULT 0,
  crashes      integer  NOT NULL DEFAULT 0,
  devices      integer  NOT NULL DEFAULT 0,       -- distinct machines that reported that day
  users        integer  NOT NULL DEFAULT 0,       -- distinct users that reported that day
  health_score real,                              -- average of that day's hourly snapshots ('_all' only)
  PRIMARY KEY (panel, day, product_id)
);
ALTER TABLE ops_activity_daily ENABLE ROW LEVEL SECURITY;  -- no policies → server only

-- Re-aggregate the last p_days UTC days (today included) from raw diag_events.
-- Counters only ever go UP (GREATEST): a day can lose raw events to expiry, or gain late
-- uploads from offline devices — the highest count seen is the best record of that day.
-- Called by the daily ops cron (last 7 days, so a missed run heals itself) and, throttled,
-- while the Overview is open (today only).
CREATE OR REPLACE FUNCTION ops_activity_refresh(p_panel text, p_days int DEFAULT 2)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first date := (now() AT TIME ZONE 'UTC')::date - (greatest(p_days, 1) - 1);
  v_rows  integer;
BEGIN
  WITH agg AS (
    SELECT (e.ts AT TIME ZONE 'UTC')::date AS day,
           CASE WHEN grouping(e.product_id) = 1 THEN '_all' ELSE coalesce(e.product_id, '_unknown') END AS product_id,
           count(*)                                                              AS events,
           count(*) FILTER (WHERE e.severity IN ('ERROR','CRITICAL','FATAL'))     AS errors,
           count(*) FILTER (WHERE e.severity = 'WARNING')                         AS warnings,
           count(*) FILTER (WHERE e.category = 'CRASH')                           AS crashes,
           count(DISTINCT e.machine_id)                                           AS devices,
           count(DISTINCT e.user_id)                                              AS users
    FROM diag_events e
    WHERE e.panel = p_panel AND e.ts >= v_first::timestamp AT TIME ZONE 'UTC'
    GROUP BY GROUPING SETS (((e.ts AT TIME ZONE 'UTC')::date, e.product_id), ((e.ts AT TIME ZONE 'UTC')::date))
  )
  INSERT INTO ops_activity_daily AS a (panel, day, product_id, events, errors, warnings, crashes, devices, users)
  SELECT p_panel, day, product_id, events, errors, warnings, crashes, devices, users FROM agg
  ON CONFLICT (panel, day, product_id) DO UPDATE SET
    events   = greatest(a.events,   excluded.events),
    errors   = greatest(a.errors,   excluded.errors),
    warnings = greatest(a.warnings, excluded.warnings),
    crashes  = greatest(a.crashes,  excluded.crashes),
    devices  = greatest(a.devices,  excluded.devices),
    users    = greatest(a.users,    excluded.users);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Daily health = average of the hourly snapshots (ops_rollups, kept 30 days) of that day.
  INSERT INTO ops_activity_daily AS a (panel, day, product_id, health_score)
  SELECT p_panel, (r.bucket AT TIME ZONE 'UTC')::date, '_all', avg(r.value)::real
  FROM ops_rollups r
  WHERE r.panel = p_panel AND r.granularity = 'hour' AND r.product_id = '_all' AND r.metric = 'health_score'
    AND r.bucket >= v_first::timestamp AT TIME ZONE 'UTC'
  GROUP BY 2
  ON CONFLICT (panel, day, product_id) DO UPDATE SET health_score = excluded.health_score;

  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION ops_activity_refresh(text, int) FROM public, anon, authenticated;

COMMIT;

-- Optional one-off: fill the history from the raw events still stored (up to ~90 days back).
-- SELECT ops_activity_refresh('lms', 90), ops_activity_refresh('lab', 90);
