-- ============================================================================
-- Siddesh Operations Center — monitoring schema. Run AFTER diagnostics-schema.sql. Idempotent.
-- Reuses existing sources (never duplicated): device_status / lab_device_status (heartbeat),
-- device_timeline (sessions), diag_* (errors / crashes / perf). These tables only hold
-- aggregates, provider snapshots, alerts and incidents. RLS on, no policies → server only.
-- ============================================================================

-- Latest resource snapshot per device (one row per machine, upserted — never appended).
create table if not exists ops_device_metrics (
  panel text not null, machine_id text not null,
  product_id text, version text, computer_name text, entity_id text,
  cpu_pct real, ram_pct real, disk_pct real, uptime_s bigint, session_count int, status text,
  reported_at timestamptz not null default now(),
  primary key (panel, machine_id)
);
create index if not exists ops_device_metrics_entity on ops_device_metrics (panel, entity_id);

-- Hourly + daily rollups (raw diag_events expire quickly; history lives here).
create table if not exists ops_rollups (
  panel text not null, granularity text not null check (granularity in ('hour','day')),
  bucket timestamptz not null, product_id text not null default '_all', metric text not null,
  value double precision not null,
  primary key (panel, granularity, bucket, product_id, metric)
);
create index if not exists ops_rollups_metric on ops_rollups (panel, metric, granularity, bucket desc);

-- Releases seen in the field (EXE: first APP_STARTED of a version) and web deployments (provider API).
create table if not exists ops_releases (
  id bigserial primary key, panel text not null, product_id text not null, version text not null,
  build_commit text, environment text not null default 'production', source text not null,
  status text, first_seen timestamptz not null, duration_s int, url text,
  unique (panel, product_id, version, environment)
);

-- Configured infrastructure providers. credential_enc = encryptAES(json) — never returned to the UI.
create table if not exists ops_providers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('supabase','vercel','render','http','manual')),
  name text not null, service text, environment text not null default 'production',
  config jsonb not null default '{}'::jsonb,       -- non-secret: project ref / id, URL, manual quotas
  credential_enc text,
  enabled boolean not null default true,
  sync_minutes int not null default 15,
  last_sync timestamptz, last_status text, last_error text,
  created_at timestamptz not null default now()
);

-- Latest value per provider metric, with source + freshness. Never invented: absent = not available.
create table if not exists ops_provider_metrics (
  provider_id uuid not null references ops_providers(id) on delete cascade,
  metric text not null, value double precision, quota double precision, unit text,
  text_value text, source text not null check (source in ('api','manual','derived')),
  fetched_at timestamptz not null default now(),
  primary key (provider_id, metric)
);

-- Costs: from a provider API when exposed, else manual entries (labelled as such).
create table if not exists ops_costs (
  id bigserial primary key, month date not null, provider text not null, category text not null,
  amount_inr numeric(12,2) not null, source text not null check (source in ('api','manual')),
  note text, updated_by text, updated_at timestamptz not null default now(),
  unique (month, provider, category)
);

create table if not exists ops_settings (
  panel text primary key, config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by text
);

create table if not exists ops_alert_rules (
  id uuid primary key default gen_random_uuid(), panel text not null,
  name text not null, metric text not null, op text not null check (op in ('>','>=','<','<=')),
  threshold double precision not null, for_minutes int not null default 0,
  level text not null check (level in ('INFO','WARNING','CRITICAL')),
  create_incident boolean not null default false, enabled boolean not null default true,
  breach_since timestamptz, created_at timestamptz not null default now()
);

create table if not exists ops_alerts (
  id uuid primary key default gen_random_uuid(), panel text not null,
  rule_id uuid references ops_alert_rules(id) on delete set null,
  dedup_key text not null, level text not null, category text not null, title text not null,
  value double precision, status text not null default 'NEW' check (status in ('NEW','ACKNOWLEDGED','RESOLVED')),
  occurrences int not null default 1, first_at timestamptz not null default now(), last_at timestamptz not null default now(),
  acknowledged_by text, resolved_at timestamptz
);
-- One OPEN alert per dedup key = grouping/deduplication (no alert spam).
create unique index if not exists ops_alerts_open_dedup on ops_alerts (panel, dedup_key) where status <> 'RESOLVED';
create index if not exists ops_alerts_panel on ops_alerts (panel, status, last_at desc);

create sequence if not exists ops_incident_seq;
create table if not exists ops_incidents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('INC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD') || '-' || lpad(nextval('ops_incident_seq')::text, 4, '0')),
  panel text not null, title text not null, severity text not null, product_id text,
  status text not null default 'DETECTED' check (status in ('DETECTED','INVESTIGATING','IDENTIFIED','MITIGATING','RESOLVED','CLOSED')),
  alert_id uuid references ops_alerts(id) on delete set null, rule_id uuid,
  affected jsonb, started_at timestamptz not null default now(), resolved_at timestamptz,
  updates jsonb not null default '[]'::jsonb, created_by text not null default 'system'
);
create index if not exists ops_incidents_panel on ops_incidents (panel, status, started_at desc);

alter table ops_device_metrics enable row level security;
alter table ops_rollups enable row level security;
alter table ops_releases enable row level security;
alter table ops_providers enable row level security;
alter table ops_provider_metrics enable row level security;
alter table ops_costs enable row level security;
alter table ops_settings enable row level security;
alter table ops_alert_rules enable row level security;
alter table ops_alerts enable row level security;
alter table ops_incidents enable row level security;

-- Event counts per time bucket (uses diag_events_filter index). Never ships raw rows to the browser.
create or replace function ops_event_series(p_panel text, p_from timestamptz, p_to timestamptz, p_bucket_s int, p_product text)
returns table (bucket timestamptz, events bigint, errors bigint, warnings bigint, crashes bigint, machines bigint, users bigint)
language sql stable security definer set search_path = public as $$
  select date_bin(make_interval(secs => p_bucket_s), ts, p_from) as bucket,
         count(*), count(*) filter (where severity in ('ERROR','CRITICAL','FATAL')),
         count(*) filter (where severity = 'WARNING'), count(*) filter (where category = 'CRASH'),
         count(distinct machine_id), count(distinct user_id)
  from diag_events
  where panel = p_panel and ts >= p_from and ts < p_to and (p_product is null or product_id = p_product)
  group by 1 order by 1;
$$;

-- Latency percentiles from reported durations (startup, screens, API, compile …). P50…P99, not averages.
create or replace function ops_percentiles(p_panel text, p_from timestamptz, p_to timestamptz, p_product text)
returns table (category text, name text, n bigint, errors bigint, p50 double precision, p75 double precision,
               p90 double precision, p95 double precision, p99 double precision)
language sql stable security definer set search_path = public as $$
  select category, coalesce(case when category = 'API' then feature else null end, event_type) as name, count(*),
         count(*) filter (where event_type in ('API_REQUEST_FAILED','API_TIMEOUT') or result = 'FAIL'),
         percentile_cont(0.50) within group (order by duration_ms), percentile_cont(0.75) within group (order by duration_ms),
         percentile_cont(0.90) within group (order by duration_ms), percentile_cont(0.95) within group (order by duration_ms),
         percentile_cont(0.99) within group (order by duration_ms)
  from diag_events
  where panel = p_panel and ts >= p_from and ts < p_to and duration_ms is not null
    and (p_product is null or product_id = p_product)
  group by 1, 2 order by 3 desc limit 50;
$$;

-- Postgres health from the catalog (real values only). pg_stat_statements is optional.
create or replace function ops_db_stats() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v jsonb; v_slow jsonb := null;
begin
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'active_connections', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'),
    'max_connections', current_setting('max_connections')::int,
    'waiting_locks', (select count(*) from pg_locks where not granted),
    'long_running_queries', (select count(*) from pg_stat_activity where state = 'active' and now() - query_start > interval '30 seconds'),
    'xact_commit', d.xact_commit, 'xact_rollback', d.xact_rollback, 'deadlocks', d.deadlocks,
    'cache_hit_pct', round(100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0), 2),
    'stats_reset', d.stats_reset,
    'largest_tables', (select jsonb_agg(t) from (
        select c.relname as name, pg_total_relation_size(c.oid) as total_bytes, pg_indexes_size(c.oid) as index_bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc limit 10) t)
  ) into v from pg_stat_database d where d.datname = current_database();
  begin
    execute $q$ select jsonb_agg(s) from (select left(query, 120) as query, calls, round(mean_exec_time::numeric, 1) as mean_ms,
                round(max_exec_time::numeric, 1) as max_ms from pg_stat_statements
                where mean_exec_time > 500 order by mean_exec_time desc limit 10) s $q$ into v_slow;
  exception when others then v_slow := null; -- extension not enabled → "Not available"
  end;
  return v || jsonb_build_object('slow_queries', v_slow);
end $$;

-- Storage usage per bucket (Supabase Storage metadata).
create or replace function ops_storage_stats() returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select coalesce(jsonb_agg(b), '[]'::jsonb) from (
    select bucket_id as bucket, count(*) as files, coalesce(sum((metadata->>'size')::bigint), 0) as bytes,
           count(*) filter (where created_at > now() - interval '24 hours') as files_24h,
           coalesce(sum((metadata->>'size')::bigint) filter (where created_at > now() - interval '30 days'), 0) as bytes_30d
    from storage.objects group by bucket_id order by 3 desc) b;
$$;

revoke all on function ops_event_series from public, anon, authenticated;
revoke all on function ops_percentiles from public, anon, authenticated;
revoke all on function ops_db_stats from public, anon, authenticated;
revoke all on function ops_storage_stats from public, anon, authenticated;
