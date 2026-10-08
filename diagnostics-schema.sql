-- ============================================================================
-- Siddesh Logs — diagnostics schema (temporary diagnostic data, NOT business data).
-- Run once in the Supabase SQL editor. Idempotent.
--
-- Separation: business tables (schools, keys, …) are never referenced with ON DELETE
-- CASCADE from here, so diagnostic cleanup can never delete business data.
-- RLS is enabled with NO policies → only the service role (server code) can touch these.
-- Large binaries (dumps, screenshots, bundles) live in the PRIVATE storage bucket
-- 'diagnostics'; the DB stores only references (diag_artifacts).
-- BACKUPS: rows deleted here still exist in Supabase PITR/daily backups until those
-- backups age out (plan-dependent, typically 7–30 days). See docs in LOGS.md.
-- ============================================================================

create extension if not exists pgcrypto;

-- Per-panel settings (retention etc.) — values are policy, edited from the Logs tab.
create table if not exists diag_settings (
  panel text primary key check (panel in ('lms','lab')),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Logs RBAC (separate from panel login: authenticated ≠ authorized).
create table if not exists diag_roles (
  panel text not null check (panel in ('lms','lab')),
  email text not null,
  role text not null check (role in ('VIEWER','DEVELOPER','DEBUG_ADMIN','SUPER_ADMIN')),
  school_ids text[],            -- null = all schools of the panel; else entity ids allowed
  updated_at timestamptz not null default now(),
  primary key (panel, email)
);

create sequence if not exists diag_issue_seq;

-- Logical issue = one error fingerprint (grouped crashes/errors) + bug/lifecycle record.
create table if not exists diag_issues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('BUG-' || lpad(nextval('diag_issue_seq')::text, 5, '0')),
  panel text not null,
  fingerprint text not null,
  kind text not null,                     -- CRASH | ERROR | WARNING | USER_REPORT
  severity text not null,
  title text not null,
  product_id text,
  exception_type text,
  message_sample text,
  stack_sample text,
  expected_behavior text,
  actual_behavior text,
  status text not null default 'NEW' check (status in
    ('NEW','REVIEWING','DOWNLOADED','INVESTIGATING','RESOLVED','DELETE_PENDING','DELETED','REOPENED')),
  occurrence_count bigint not null default 0,
  affected_schools text[] not null default '{}',
  affected_machines text[] not null default '{}',
  affected_versions text[] not null default '{}',
  affected_modules text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  downloaded_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  root_cause text,
  resolution text,
  fixed_version text,
  developer_notes text,
  delete_after timestamptz,
  deleted_at timestamptz,
  reopen_count int not null default 0,
  unique (panel, fingerprint)
);
create index if not exists diag_issues_panel_status on diag_issues (panel, status, last_seen_at desc);
create index if not exists diag_issues_delete_after on diag_issues (delete_after) where delete_after is not null;

-- Crash records. Hold their OWN snapshot of the last-N events, so raw events can expire
-- independently while a crash is under investigation.
create table if not exists diag_crashes (
  id uuid primary key,                    -- crash_id from the client (dedup)
  code text not null unique,              -- CR-YYYYMMDD-xxxxx
  panel text not null,
  issue_id uuid not null references diag_issues(id) on delete cascade,
  ts timestamptz not null,
  received_at timestamptz not null default now(),
  product_id text, product_version text, build_number text, build_commit text,
  entity_id text, school_name text, installation_id text, machine_id text, computer_name text,
  user_id text, session_id text, process_id int,
  module text, feature text, action text, current_screen text,
  event_type text not null,
  exception jsonb, stack_trace text,
  expected_behavior text, actual_behavior text, result text,
  last_events jsonb, app_state jsonb, system_info jsonb, network_state jsonb, perf_state jsonb
);
create index if not exists diag_crashes_issue on diag_crashes (issue_id, ts desc);
create index if not exists diag_crashes_panel_ts on diag_crashes (panel, ts desc);
create index if not exists diag_crashes_machine on diag_crashes (machine_id);

-- Raw events: lightweight metadata + bounded `data`. Short, severity-based expires_at.
create table if not exists diag_events (
  id uuid primary key,                    -- event_id from the client (dedup)
  panel text not null,
  ts timestamptz not null,
  received_at timestamptz not null default now(),
  product_id text, product_version text, build_number text, build_commit text,
  entity_id text, school_name text, installation_id text, machine_id text, computer_name text,
  user_id text, session_id text, process_id int,
  module text, feature text, action text,
  correlation_id text, request_id text,
  severity text not null, event_type text not null, category text not null,
  message text, error_code text, duration_ms int, result text,
  fingerprint text, issue_id uuid references diag_issues(id) on delete set null,
  crash_id uuid,
  data jsonb,
  expires_at timestamptz not null
);
create index if not exists diag_events_panel_ts on diag_events (panel, ts desc);
create index if not exists diag_events_expires on diag_events (expires_at);
create index if not exists diag_events_session on diag_events (session_id, ts);
create index if not exists diag_events_correlation on diag_events (correlation_id) where correlation_id is not null;
create index if not exists diag_events_issue on diag_events (issue_id) where issue_id is not null;
create index if not exists diag_events_filter on diag_events (panel, category, severity, ts desc);
create index if not exists diag_events_entity on diag_events (panel, entity_id, ts desc);

-- Artifact references (binary lives in storage bucket 'diagnostics').
create table if not exists diag_artifacts (
  id uuid primary key default gen_random_uuid(),
  panel text not null,
  issue_id uuid references diag_issues(id) on delete set null,
  crash_id uuid,
  kind text not null check (kind in ('DUMP','SCREENSHOT','LOG','BUNDLE')),
  storage_path text not null unique,
  size_bytes bigint not null,
  sha256 text not null,
  mime text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DELETE_PENDING')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists diag_artifacts_issue on diag_artifacts (issue_id);
create index if not exists diag_artifacts_crash on diag_artifacts (crash_id);
create index if not exists diag_artifacts_status on diag_artifacts (status, expires_at);

-- Security audit trail of the Logs system itself. Separate retention; no UI delete.
create table if not exists diag_audit (
  id bigserial primary key,
  panel text not null,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  resource_id text,
  result text not null,
  ip text,
  detail jsonb
);
create index if not exists diag_audit_panel_at on diag_audit (panel, at desc);

-- Cleanup run history (shown on the storage dashboard).
create table if not exists diag_cleanup_runs (
  id bigserial primary key,
  panel text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  events_deleted int default 0,
  crashes_deleted int default 0,
  issues_purged int default 0,
  artifacts_deleted int default 0,
  orphans_deleted int default 0,
  bytes_reclaimed bigint default 0,
  error text
);

alter table diag_settings enable row level security;
alter table diag_roles enable row level security;
alter table diag_issues enable row level security;
alter table diag_crashes enable row level security;
alter table diag_events enable row level security;
alter table diag_artifacts enable row level security;
alter table diag_audit enable row level security;
alter table diag_cleanup_runs enable row level security;

-- Atomic fingerprint upsert: increments counts, merges affected sets (capped at 500),
-- and REOPENS a resolved/deleted issue on recurrence (recurrence is never lost).
create or replace function diag_touch_issue(
  p_panel text, p_fingerprint text, p_kind text, p_severity text, p_title text,
  p_product text, p_exc_type text, p_message text, p_stack text,
  p_expected text, p_actual text,
  p_school text, p_machine text, p_version text, p_module text,
  p_count int, p_seen timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into diag_issues as i (panel, fingerprint, kind, severity, title, product_id, exception_type,
    message_sample, stack_sample, expected_behavior, actual_behavior, occurrence_count,
    affected_schools, affected_machines, affected_versions, affected_modules, first_seen_at, last_seen_at)
  values (p_panel, p_fingerprint, p_kind, p_severity, p_title, p_product, p_exc_type, p_message, p_stack,
    p_expected, p_actual, p_count,
    array_remove(array[p_school], null), array_remove(array[p_machine], null),
    array_remove(array[p_version], null), array_remove(array[p_module], null), p_seen, p_seen)
  on conflict (panel, fingerprint) do update set
    occurrence_count = i.occurrence_count + p_count,
    last_seen_at = greatest(i.last_seen_at, p_seen),
    severity = case when p_kind = 'CRASH' then p_severity else i.severity end,
    kind = case when p_kind = 'CRASH' then 'CRASH' else i.kind end,
    stack_sample = coalesce(i.stack_sample, p_stack),
    message_sample = coalesce(i.message_sample, p_message),
    affected_schools = case when p_school is null or p_school = any(i.affected_schools)
      or cardinality(i.affected_schools) >= 500 then i.affected_schools else i.affected_schools || p_school end,
    affected_machines = case when p_machine is null or p_machine = any(i.affected_machines)
      or cardinality(i.affected_machines) >= 500 then i.affected_machines else i.affected_machines || p_machine end,
    affected_versions = case when p_version is null or p_version = any(i.affected_versions)
      or cardinality(i.affected_versions) >= 200 then i.affected_versions else i.affected_versions || p_version end,
    affected_modules = case when p_module is null or p_module = any(i.affected_modules)
      or cardinality(i.affected_modules) >= 200 then i.affected_modules else i.affected_modules || p_module end,
    status = case when i.status in ('RESOLVED','DELETE_PENDING','DELETED') then 'REOPENED' else i.status end,
    reopen_count = i.reopen_count + case when i.status in ('RESOLVED','DELETE_PENDING','DELETED') then 1 else 0 end,
    delete_after = case when i.status in ('RESOLVED','DELETE_PENDING','DELETED') then null else i.delete_after end,
    deleted_at = case when i.status in ('RESOLVED','DELETE_PENDING','DELETED') then null else i.deleted_at end
  returning id into v_id;
  return v_id;
end $$;

-- Storage dashboard numbers. Table sizes are physical (shared by both panels).
create or replace function diag_storage_stats(p_panel text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'events_table_bytes', pg_total_relation_size('diag_events'),
    'crashes_table_bytes', pg_total_relation_size('diag_crashes'),
    'issues_table_bytes', pg_total_relation_size('diag_issues'),
    'audit_table_bytes', pg_total_relation_size('diag_audit'),
    'db_bytes', pg_database_size(current_database()),
    'events_count', (select count(*) from diag_events where panel = p_panel),
    'crashes_count', (select count(*) from diag_crashes where panel = p_panel),
    'issues_open', (select count(*) from diag_issues where panel = p_panel and status not in ('RESOLVED','DELETE_PENDING','DELETED')),
    'issues_pending_delete', (select count(*) from diag_issues where panel = p_panel and status in ('RESOLVED','DELETE_PENDING')),
    'oldest_event', (select min(ts) from diag_events where panel = p_panel),
    'artifacts', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('count', c, 'bytes', b)), '{}'::jsonb)
                  from (select kind, count(*) c, sum(size_bytes) b from diag_artifacts where panel = p_panel group by kind) a),
    'pending_delete_bytes', (select coalesce(sum(size_bytes),0) from diag_artifacts a
                  where a.panel = p_panel and (a.status = 'DELETE_PENDING'
                    or a.issue_id in (select id from diag_issues where panel = p_panel and status in ('RESOLVED','DELETE_PENDING'))))
  );
$$;

revoke all on function diag_touch_issue from public, anon, authenticated;
revoke all on function diag_storage_stats from public, anon, authenticated;

-- Private bucket for binaries (never public).
insert into storage.buckets (id, name, public, file_size_limit)
values ('diagnostics', 'diagnostics', false, 52428800)
on conflict (id) do update set public = false;
