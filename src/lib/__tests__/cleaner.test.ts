import { describe, expect, it } from 'vitest';
import { CLEANER, cleanBatch, prune } from '../diagnostics/cleaner';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  severity: 'INFO', event_type: 'SCREEN_OPENED', module: 'App', action: null, feature: 'home', message: null, session_id: 's1',
  data: { extra: { a: 1 } } as unknown, ...over,
}) as { severity: string; event_type: string; module: string | null; action: string | null; feature: string | null; message: string | null; session_id: string | null; data: unknown };

describe('ingest cleaner', () => {
  it('prunes empty values and caps strings', () => {
    expect(prune({ a: null, b: '', c: {}, d: [], e: { f: '  ' }, g: 0, h: false, i: 'x' })).toEqual({ g: 0, h: false, i: 'x' });
    expect((prune('y'.repeat(CLEANER.maxString + 50)) as string).length).toBe(CLEANER.maxString + 1);
    expect(prune({})).toBeUndefined();
  });

  it('drops DEBUG and collapses identical events in a batch', () => {
    const { keep, stats } = cleanBatch([row(), row(), row({ severity: 'DEBUG' }), row({ feature: 'other' }), row()], { info: 0, warn: 0 });
    expect(keep).toHaveLength(2);
    expect((keep[0].data as { collapsed?: number }).collapsed).toBe(3);
    expect((keep[1].data as { collapsed?: number }).collapsed).toBeUndefined();
    expect(stats).toEqual({ debug: 1, collapsed: 2, quota: 0, pressure: 0 });
  });

  it('enforces the per-device daily quota separately for INFO and WARNING+', () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ feature: `f${i}` }));
    const r = cleanBatch(many, { info: CLEANER.infoPerDevicePerDay - 3, warn: 0 });
    expect(r.keep).toHaveLength(3);
    expect(r.stats.quota).toBe(7);
    const w = cleanBatch([row({ severity: 'CRITICAL' }), row({ severity: 'WARNING', feature: 'x' })], { info: CLEANER.infoPerDevicePerDay, warn: CLEANER.warnPerDevicePerDay - 1 });
    expect(w.keep.map((x) => x.severity)).toEqual(['CRITICAL']);
  });

  it('keeps only important rows when the logs database is nearly full', () => {
    const batch = [row(), row({ severity: 'WARNING', feature: 'w' }), row({ severity: 'ERROR', feature: 'e' }), row({ severity: 'CRITICAL', feature: 'c' })];
    expect(cleanBatch(batch, { info: 0, warn: 0 }, 50).keep).toHaveLength(4);
    const warn = cleanBatch(batch, { info: 0, warn: 0 }, CLEANER.pressureWarnPct);
    expect(warn.keep.map((x) => x.severity)).toEqual(['WARNING', 'ERROR', 'CRITICAL']);
    expect(warn.stats.pressure).toBe(1);
    expect(cleanBatch(batch, { info: 0, warn: 0 }, CLEANER.pressureCriticalPct).keep.map((x) => x.severity)).toEqual(['CRITICAL']);
  });
});
