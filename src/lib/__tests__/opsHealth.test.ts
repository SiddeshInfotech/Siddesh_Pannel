import { describe, it, expect } from 'vitest';
import {
  bucketSeconds, compareVersions, evaluateRule, freshness, healthScore, heartbeatState, mergeOps, pct, regressionCheck, statusOf, versionDistribution, DEFAULT_OPS,
} from '../ops/health';
import { hasPermission } from '../diagnostics/core';

const now = Date.parse('2026-10-08T10:00:00Z');

describe('health score', () => {
  it('no data → UNKNOWN, never a fabricated 100', () => {
    expect(healthScore({})).toEqual({ score: null, status: 'UNKNOWN', penalties: [] });
    expect(healthScore({ openIncidents: [], openAlerts: [] }).status).toBe('UNKNOWN'); // empty incident list ≠ healthy
  });
  it('clean fleet → 100 HEALTHY', () => {
    const r = healthScore({ crashes24h: 0, activeDevices24h: 100, errors24h: 0, events24h: 1000, openIncidents: [], openAlerts: [], providers: [{ status: 'HEALTHY' }] });
    expect(r.score).toBe(100);
    expect(r.status).toBe('HEALTHY');
  });
  it('penalties are capped and explained', () => {
    const r = healthScore({ crashes24h: 50, activeDevices24h: 100, errors24h: 500, events24h: 1000, openIncidents: [{ severity: 'CRITICAL' }, { severity: 'CRITICAL' }, { severity: 'CRITICAL' }], providers: [{ status: 'DOWN' }] });
    expect(r.penalties.find((p) => p.reason.startsWith('Crash'))!.points).toBe(30);
    expect(r.penalties.find((p) => p.reason.startsWith('Error'))!.points).toBe(20);
    expect(r.penalties.find((p) => p.reason.includes('incident'))!.points).toBe(30);
    expect(r.score).toBe(10);
    expect(r.status).toBe('CRITICAL');
  });
  it('quota usage penalties only when quota known', () => {
    expect(healthScore({ dbUsagePct: 85 }).score).toBe(95);
    expect(healthScore({ dbUsagePct: 95, storageUsagePct: 50 }).score).toBe(90);
    expect(healthScore({ dbUsagePct: null }).status).toBe('UNKNOWN');
  });
  it('status thresholds', () => {
    expect([statusOf(95), statusOf(75), statusOf(40), statusOf(null)]).toEqual(['HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN']);
  });
});

describe('heartbeat / offline detection', () => {
  it('online → stale → offline → unknown', () => {
    expect(heartbeatState(new Date(now - 60_000).toISOString(), now, 6, 30)).toBe('ONLINE');
    expect(heartbeatState(new Date(now - 10 * 60_000).toISOString(), now, 6, 30)).toBe('STALE');
    expect(heartbeatState(new Date(now - 3600_000).toISOString(), now, 6, 30)).toBe('OFFLINE');
    expect(heartbeatState(null, now, 6, 30)).toBe('UNKNOWN');
  });
});

describe('versions + regressions', () => {
  it('semver ordering and distribution', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    const d = versionDistribution(['2.4.1', '2.4.1', '2.4.0', '2.3.9', null]);
    expect(d.latest).toBe('2.4.1');
    expect(d.outdated).toBe(2);
    expect(d.rows[0]).toEqual({ version: '2.4.1', devices: 2, pct: 40 });
    expect(d.rows.at(-1)!.version).toBe('unknown');
  });
  it('flags a jump as Potential Regression, not noise', () => {
    expect(regressionCheck({ errors: 3, crashes: 2, devices: 100 }, { errors: 48, crashes: 37, devices: 100 }).label).toBe('Potential Regression');
    expect(regressionCheck({ errors: 3, crashes: 0, devices: 100 }, { errors: 4, crashes: 1, devices: 100 }).flagged).toBe(false);
    expect(regressionCheck({ errors: 0, crashes: 0, devices: 0 }, { errors: 50, crashes: 5, devices: 1 }).flagged).toBe(false); // too few devices
  });
});

describe('alert rule engine', () => {
  const rule = { op: '>', threshold: 2, for_minutes: 5, breach_since: null as string | null };
  it('needs the breach to persist for for_minutes', () => {
    const first = evaluateRule(rule, 3, now);
    expect(first.action).toBe('pending');
    const later = evaluateRule({ ...rule, breach_since: first.breachSince }, 3, now + 5 * 60_000);
    expect(later.action).toBe('fire');
  });
  it('clears when recovered and never fires without data', () => {
    expect(evaluateRule({ ...rule, breach_since: new Date(now).toISOString() }, 1, now).action).toBe('clear');
    expect(evaluateRule(rule, null, now).action).toBe('none');
  });
  it('immediate rules fire at once', () => {
    expect(evaluateRule({ op: '>=', threshold: 80, for_minutes: 0, breach_since: null }, 80, now).action).toBe('fire');
  });
});

describe('misc', () => {
  it('chart buckets stay small', () => {
    for (const ms of [15 * 60_000, 3600_000, 86_400_000, 30 * 86_400_000]) expect(ms / (bucketSeconds(ms) * 1000)).toBeLessThanOrEqual(60);
  });
  it('freshness and pct never invent values', () => {
    expect(freshness(null, now, 15)).toBe('NONE');
    expect(freshness(new Date(now - 60 * 60_000).toISOString(), now, 15)).toBe('STALE');
    expect(pct(10, null)).toBeNull();
    expect(pct(12.4, 50)).toBe(24.8);
  });
  it('settings bounded', () => {
    expect(mergeOps({ onlineMinutes: 10, staleMinutes: 5, rawDays: 9999 })).toMatchObject({ onlineMinutes: 10, staleMinutes: 11, rawDays: DEFAULT_OPS.rawDays });
  });
  it('RBAC: viewer sees ops, not infra; only super admin manages providers', () => {
    expect(hasPermission('VIEWER', 'OPS_VIEW')).toBe(true);
    expect(hasPermission('VIEWER', 'INFRA_VIEW')).toBe(false);
    expect(hasPermission('DEVELOPER', 'INFRA_VIEW')).toBe(true);
    expect(hasPermission('DEBUG_ADMIN', 'OPS_MANAGE')).toBe(true);
    expect(hasPermission('DEBUG_ADMIN', 'INFRA_MANAGE')).toBe(false);
    expect(hasPermission('SUPER_ADMIN', 'INFRA_MANAGE')).toBe(true);
  });
});
