-- Siddesh Logs: per-device lookups (Health → key search, ingest cleaner daily quota).
-- Run once in the Supabase SQL editor (manual SQL, no migrations runner). Safe to re-run.
create index if not exists diag_events_machine_ts on diag_events (panel, machine_id, ts desc);
create index if not exists diag_events_machine_received on diag_events (panel, machine_id, received_at);
create index if not exists diag_crashes_machine_ts on diag_crashes (panel, machine_id, ts desc);
