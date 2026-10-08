// Siddesh Operations Center — provider integrations (server-only).
// Each provider implements only what its OFFICIAL API exposes. Anything else is either a
// manual value (labelled 'manual') or absent (shown as "Not available") — never invented.
// Credentials arrive decrypted in memory only for the sync call and are never logged/returned.
import 'server-only';

export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
export type MetricPoint = { metric: string; value?: number | null; quota?: number | null; unit?: string; text?: string | null; source: 'api' | 'manual' | 'derived' };
export type Release = { product_id: string; version: string; build_commit?: string | null; environment: string; status?: string | null; first_seen: string; duration_s?: number | null; url?: string | null };
export type SyncResult = { status: ProviderStatus; metrics: MetricPoint[]; releases: Release[] };
export type ProviderRow = { id: string; kind: string; name: string; environment: string; config: Record<string, unknown> };

export interface MonitoringProvider {
  /** getHealth + getUsage + getQuota + getDeployments in one round-trip-friendly call. */
  sync(p: ProviderRow, secret: string | null): Promise<SyncResult>;
}

const TIMEOUT = 10_000;
async function getJson(url: string, token: string | null, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // status only — never echo bodies (may contain tokens)
  return res.json();
}
const s = (v: unknown) => (typeof v === 'string' ? v : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const GB = 1024 ** 3;

/** Manual quotas/usages configured by an admin: config.manual = [{metric, value, quota, unit}]. */
function manualMetrics(p: ProviderRow): MetricPoint[] {
  const list = Array.isArray(p.config.manual) ? p.config.manual : [];
  return list.flatMap((m: Record<string, unknown>) => (typeof m?.metric === 'string'
    ? [{ metric: m.metric.slice(0, 60), value: n(m.value), quota: n(m.quota), unit: s(m.unit) ?? undefined, source: 'manual' as const }] : []));
}

// ── Supabase Management API (https://api.supabase.com) ───────────────────────
const supabase: MonitoringProvider = {
  async sync(p, token) {
    const ref = s(p.config.projectRef);
    const metrics: MetricPoint[] = [...manualMetrics(p)];
    let status: ProviderStatus = 'UNKNOWN';
    if (ref && token) {
      const base = `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`;
      const health = await getJson(`${base}/health?services=auth&services=db&services=rest&services=realtime&services=storage`, token).catch(() => null);
      if (Array.isArray(health)) {
        const bad = health.filter((h: Record<string, unknown>) => h.healthy !== true);
        status = bad.length === 0 ? 'HEALTHY' : bad.length === health.length ? 'DOWN' : 'DEGRADED';
        for (const h of health) metrics.push({ metric: `service_${s(h.name) ?? 'unknown'}`, text: h.healthy === true ? 'healthy' : s(h.status) ?? 'unhealthy', source: 'api' });
      }
      const backups = await getJson(`${base}/database/backups`, token).catch(() => null) as Record<string, unknown> | null;
      if (backups) {
        const list = Array.isArray(backups.backups) ? backups.backups as Record<string, unknown>[] : [];
        const last = list.map((b) => s(b.inserted_at)).filter(Boolean).sort().at(-1) ?? null;
        metrics.push({ metric: 'last_backup', text: last ?? 'none reported', source: 'api' });
        metrics.push({ metric: 'pitr_enabled', text: backups.pitr_enabled === true ? 'yes' : 'no', source: 'api' });
      }
      const counts = await getJson(`${base}/analytics/endpoints/usage.api-counts?interval=1day`, token).catch(() => null) as Record<string, unknown> | null;
      const rows = Array.isArray(counts?.result) ? counts!.result as Record<string, unknown>[] : null;
      if (rows) {
        const sum = (k: string) => rows.reduce((t, r) => t + (n(r[k]) ?? 0), 0);
        metrics.push({ metric: 'api_requests_24h', value: sum('total_rest_requests') + sum('total_storage_requests') + sum('total_auth_requests') + sum('total_realtime_requests'), unit: 'requests', source: 'api' });
        metrics.push({ metric: 'auth_requests_24h', value: sum('total_auth_requests'), unit: 'requests', source: 'api' });
        metrics.push({ metric: 'storage_requests_24h', value: sum('total_storage_requests'), unit: 'requests', source: 'api' });
      }
    }
    return { status, metrics, releases: [] };
  },
};

// ── Vercel REST API (https://api.vercel.com) — deployments + state. Usage/billing has no
//    official public endpoint → manual values only.
const vercel: MonitoringProvider = {
  async sync(p, token) {
    const project = s(p.config.projectId);
    if (!project || !token) return { status: 'UNKNOWN', metrics: manualMetrics(p), releases: [] };
    const team = s(p.config.teamId);
    const q = new URLSearchParams({ projectId: project, limit: '20' });
    if (team) q.set('teamId', team);
    const data = await getJson(`https://api.vercel.com/v6/deployments?${q}`, token) as Record<string, unknown>;
    const deps = Array.isArray(data.deployments) ? data.deployments as Record<string, unknown>[] : [];
    const releases: Release[] = deps.map((d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const created = n(d.created) ?? n(d.createdAt) ?? Date.now();
      const ready = n(d.ready);
      return {
        product_id: s(p.config.productId) ?? p.name, version: s(meta.githubCommitSha)?.slice(0, 7) ?? s(d.uid) ?? 'unknown',
        build_commit: s(meta.githubCommitSha), environment: s(d.target) ?? 'preview', status: s(d.state) ?? s(d.readyState),
        first_seen: new Date(created).toISOString(), duration_s: ready ? Math.round((ready - (n(d.buildingAt) ?? created)) / 1000) : null,
        url: s(d.inspectorUrl),
      };
    });
    const prod = releases.find((r) => r.environment === 'production');
    const status: ProviderStatus = !prod ? 'UNKNOWN' : prod.status === 'READY' ? 'HEALTHY' : prod.status === 'ERROR' || prod.status === 'CANCELED' ? 'DEGRADED' : 'HEALTHY';
    const metrics: MetricPoint[] = [...manualMetrics(p),
      { metric: 'deployments_listed', value: releases.length, source: 'api' },
      { metric: 'failed_deployments_recent', value: releases.filter((r) => r.status === 'ERROR').length, source: 'api' }];
    return { status, metrics, releases };
  },
};

// ── Render API (https://api.render.com/v1) — service status + deploy history.
const render: MonitoringProvider = {
  async sync(p, token) {
    const svc = s(p.config.serviceId);
    if (!svc || !token) return { status: 'UNKNOWN', metrics: manualMetrics(p), releases: [] };
    const base = `https://api.render.com/v1/services/${encodeURIComponent(svc)}`;
    const info = await getJson(base, token) as Record<string, unknown>;
    const deploys = await getJson(`${base}/deploys?limit=20`, token).catch(() => []) as Record<string, unknown>[];
    const releases: Release[] = (Array.isArray(deploys) ? deploys : []).map((x) => (x.deploy ?? x) as Record<string, unknown>).map((d) => {
      const commit = (d.commit ?? {}) as Record<string, unknown>;
      const created = s(d.createdAt) ?? new Date().toISOString();
      const fin = s(d.finishedAt);
      return { product_id: s(p.config.productId) ?? p.name, version: s(commit.id)?.slice(0, 7) ?? s(d.id) ?? 'unknown', build_commit: s(commit.id),
        environment: p.environment, status: s(d.status), first_seen: created, duration_s: fin ? Math.round((Date.parse(fin) - Date.parse(created)) / 1000) : null, url: null };
    });
    const suspended = s(info.suspended) === 'suspended';
    const last = releases[0]?.status;
    const status: ProviderStatus = suspended ? 'DOWN' : last && /failed|canceled/i.test(last) ? 'DEGRADED' : 'HEALTHY';
    return { status, metrics: [...manualMetrics(p), { metric: 'service_state', text: suspended ? 'suspended' : 'running', source: 'api' }], releases };
  },
};

// ── Generic HTTP health check (any backend / CDN / AI service / SMS gateway status URL).
const http: MonitoringProvider = {
  async sync(p) {
    const url = s(p.config.url);
    if (!url || !/^https:\/\//.test(url)) return { status: 'UNKNOWN', metrics: manualMetrics(p), releases: [] };
    const t0 = Date.now();
    let ok = false, code = 0;
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store', redirect: 'manual' });
      code = res.status; ok = res.status >= 200 && res.status < 400;
    } catch { ok = false; }
    const ms = Date.now() - t0;
    const slow = n(p.config.slowMs) ?? 3000;
    return {
      status: !ok ? 'DOWN' : ms > slow ? 'DEGRADED' : 'HEALTHY',
      metrics: [...manualMetrics(p), { metric: 'response_ms', value: ms, unit: 'ms', source: 'api' }, { metric: 'http_status', value: code || null, source: 'api' }, { metric: 'check_ok', value: ok ? 1 : 0, source: 'api' }],
      releases: [],
    };
  },
};

const manual: MonitoringProvider = { async sync(p) { return { status: 'UNKNOWN', metrics: manualMetrics(p), releases: [] }; } };

export const PROVIDERS: Record<string, MonitoringProvider> = { supabase, vercel, render, http, manual };
export const PROVIDER_FIELDS: Record<string, string[]> = {
  supabase: ['projectRef'], vercel: ['projectId', 'teamId', 'productId'], render: ['serviceId', 'productId'], http: ['url', 'slowMs'], manual: [],
};
export { GB };
