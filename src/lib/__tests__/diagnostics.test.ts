import { describe, it, expect } from 'vitest';
import {
  REDACTED, boundedJson, canTransition, categoryOf, cleanBlock, cleanLine, eventExpiry, fingerprintOf, hasPermission,
  isProtected, mergeRetention, redactDeep, redactString, sniffArtifact, DEFAULT_RETENTION, LIMITS, crashCode,
} from '../diagnostics/core';
import { normalizeCrash, normalizeEvent, IngestSchema } from '../diagnostics/ingest';
import { buildZip, crc32, safeEntryName } from '../diagnostics/zip';

const ID = { panel: 'lab' as const, keyId: 'k', entityId: 'school-A', schoolName: 'School A', productId: 'lab.programming', machineId: 'fp-123456789' };
const body = IngestSchema.parse({ activation_key: 'AK-SECRET', device_fingerprint: 'fp-123456789', product_version: '2.1.0', build_number: '210', build_commit: 'abc1234' });
const now = new Date('2026-10-08T10:00:00Z');
const ev = (o: Record<string, unknown> = {}) => ({ event_id: crypto.randomUUID(), timestamp: now.toISOString(), severity: 'INFO', event_type: 'BUTTON_CLICKED', ...o });

describe('redaction', () => {
  it('masks sensitive keys at any depth', () => {
    const r = redactDeep({ user: 'x', password: 'hunter2', nested: { otp: '123456', Authorization: 'Bearer abc', apiKey: 'k', activation_key: 'AK' }, session_id: 's1' }) as any;
    expect(r.password).toBe(REDACTED);
    expect(r.nested.otp).toBe(REDACTED);
    expect(r.nested.Authorization).toBe(REDACTED);
    expect(r.nested.apiKey).toBe(REDACTED);
    expect(r.nested.activation_key).toBe(REDACTED);
    expect(r.session_id).toBe('s1'); // safe identifier preserved
  });
  it('scrubs secrets inside free text', () => {
    const s = redactString('login failed password=hunter2 token: abc.def jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlXzEyMw url https://x/y?token=SECRET&a=1 Bearer abcdefghijkl postgres://u:pw@h/db');
    expect(s).not.toMatch(/hunter2|SECRET|abcdefghijkl|eyJhbGci|:pw@/);
  });
  it('removes private keys', () => {
    expect(redactString('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----')).toBe('[REDACTED_PRIVATE_KEY]');
  });
});

describe('log injection', () => {
  it('single-line fields drop newlines, ANSI escapes and control chars', () => {
    expect(cleanLine('ok\r\n2026 FAKE ENTRY\u001b[31mred\u0007')).toBe('ok  2026 FAKE ENTRYred');
  });
  it('blocks keep newlines but not other controls', () => {
    expect(cleanBlock('a\r\nb\u0000c', 100)).toBe('a\nb c');
  });
  it('truncates oversized values', () => {
    expect(cleanLine('x'.repeat(5000))!.length).toBeLessThanOrEqual(256);
    expect(cleanBlock('y'.repeat(LIMITS.stackTrace * 2), LIMITS.stackTrace)!.length).toBeLessThanOrEqual(LIMITS.stackTrace);
  });
  it('bounded JSON never exceeds its cap', () => {
    const big = { arr: Array.from({ length: 150 }, () => 'z'.repeat(1900)) };
    const out = boundedJson(big, 8000) as any;
    expect(out._truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(9000);
  });
});

describe('fingerprinting', () => {
  const stack = 'java.lang.NullPointerException\n  at com.siddesh.lab.Compiler.run(Compiler.kt:120)\n  at com.siddesh.lab.Ui.onClick(Ui.kt:44)';
  it('same bug on different machines/lines/ids → same fingerprint', () => {
    const a = fingerprintOf({ product_id: 'p', event_type: 'APP_CRASHED', exception_type: 'NPE', message: 'user 42 at C:\\Users\\a\\x', stack });
    const b = fingerprintOf({ product_id: 'p', event_type: 'NATIVE_CRASH', exception_type: 'NPE', message: 'user 99 at C:\\Users\\b\\y', stack: stack.replace('120', '131') });
    expect(a).toBe(b);
  });
  it('different bugs → different fingerprints', () => {
    expect(fingerprintOf({ event_type: 'ERROR', message: 'disk full' })).not.toBe(fingerprintOf({ event_type: 'ERROR', message: 'file missing' }));
  });
});

describe('ingest normalization', () => {
  it('normal INFO event: no fingerprint, short retention, school from server identity', () => {
    const n = normalizeEvent(ev(), body, ID, DEFAULT_RETENTION, now)!;
    expect(n.row.fingerprint).toBeNull();
    expect(n.touch).toBeNull();
    expect(n.row.entity_id).toBe('school-A');
    expect(n.row.category).toBe('USER_ACTION');
    expect(Date.parse(n.row.expires_at) - now.getTime()).toBe(72 * 3600_000);
  });
  it('warning and error events are fingerprinted and grouped', () => {
    expect(normalizeEvent(ev({ severity: 'WARNING', event_type: 'SLOW_OPERATION', message: 'slow' }), body, ID, DEFAULT_RETENTION, now)!.touch!.kind).toBe('WARNING');
    const e = normalizeEvent(ev({ severity: 'ERROR', event_type: 'EXCEPTION', exception: { type: 'IOException', message: 'x', stack: 'at a.b(c.kt:1)' } }), body, ID, DEFAULT_RETENTION, now)!;
    expect(e.touch!.kind).toBe('ERROR');
    expect(e.row.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });
  it('rejects invalid events individually (never throws)', () => {
    expect(normalizeEvent({ garbage: true }, body, ID, DEFAULT_RETENTION, now)).toBeNull();
    expect(normalizeEvent(null, body, ID, DEFAULT_RETENTION, now)).toBeNull();
  });
  it('unknown event types are mapped, nonsense clocks clamped', () => {
    const n = normalizeEvent(ev({ event_type: 'WHATEVER', timestamp: '2099-01-01T00:00:00Z' }), body, ID, DEFAULT_RETENTION, now)!;
    expect(n.row.event_type).toBe('ERROR');
    expect(n.row.ts).toBe(now.toISOString());
  });
  it('expected vs actual behaviour is kept and redacted', () => {
    const n = normalizeEvent(ev({ severity: 'ERROR', event_type: 'ERROR', expected_behavior: 'Compile shows output', actual_behavior: 'died password=abc', result: 'FAIL' }), body, ID, DEFAULT_RETENTION, now)!;
    expect((n.row.data as any).expected_behavior).toBe('Compile shows output');
    expect((n.row.data as any).actual_behavior).not.toContain('abc');
    expect(n.row.result).toBe('FAIL');
  });
  it('crash keeps the last N events, version/build, school, machine, exception and stack', () => {
    const last = Array.from({ length: 700 }, (_, i) => ({ event_type: 'BUTTON_CLICKED', i, token: 'T' }));
    const c = normalizeCrash({
      crash_id: crypto.randomUUID(), timestamp: now.toISOString(), event_type: 'NATIVE_CRASH', module: 'Compiler', action: 'Compile',
      exception: { type: 'EXCEPTION_ACCESS_VIOLATION', native_code: '0xC0000005', stack: 'at tcc_compile+0x10' },
      expected_behavior: 'Compile shows output', actual_behavior: 'Process terminated', last_events: last, system_info: { os: 'Windows 10 19045' },
    }, body, ID, now)!;
    expect(c.row.product_version).toBe('2.1.0');
    expect(c.row.build_commit).toBe('abc1234');
    expect(c.row.entity_id).toBe('school-A');
    expect(c.row.machine_id).toBe('fp-123456789');
    expect(c.row.stack_trace).toContain('tcc_compile');
    const kept = c.row.last_events as any[];
    expect(kept.length).toBe(500);
    expect(kept[499].i).toBe(699);
    expect(kept[0].token).toBe(REDACTED);
    expect(c.touch.kind).toBe('CRASH');
  });
  it('batch size is capped', () => {
    expect(IngestSchema.safeParse({ ...body, activation_key: 'a', events: Array(501).fill({}) }).success).toBe(false);
  });
});

describe('lifecycle', () => {
  it('enforces allowed transitions', () => {
    expect(canTransition('NEW', 'REVIEWING')).toBe(true);
    expect(canTransition('RESOLVED', 'DELETE_PENDING')).toBe(true);
    expect(canTransition('NEW', 'DELETED')).toBe(false);
    expect(canTransition('DELETED', 'NEW')).toBe(false);
    expect(canTransition('INVESTIGATING', 'DELETE_PENDING')).toBe(false);
  });
  it('active investigations are protected from cleanup', () => {
    for (const s of ['NEW', 'REVIEWING', 'DOWNLOADED', 'INVESTIGATING', 'REOPENED']) expect(isProtected(s)).toBe(true);
    for (const s of ['RESOLVED', 'DELETE_PENDING']) expect(isProtected(s)).toBe(false);
  });
  it('retention is configurable but bounded', () => {
    const c = mergeRetention({ infoHours: 24, errorDays: 9999, auditDays: 1, bogus: 1 });
    expect(c.infoHours).toBe(24);
    expect(c.errorDays).toBe(DEFAULT_RETENTION.errorDays);
    expect(c.auditDays).toBe(DEFAULT_RETENTION.auditDays);
    expect(eventExpiry('ERROR', now, c).getTime() - now.getTime()).toBe(14 * 86_400_000);
  });
});

describe('RBAC', () => {
  it('viewer can view but not download or delete', () => {
    expect(hasPermission('VIEWER', 'LOG_VIEW')).toBe(true);
    expect(hasPermission('VIEWER', 'DIAGNOSTIC_DOWNLOAD')).toBe(false);
    expect(hasPermission('VIEWER', 'LOG_DELETE')).toBe(false);
  });
  it('developer downloads, cannot delete; debug admin deletes; only super admin manages policy', () => {
    expect(hasPermission('DEVELOPER', 'CRASH_DOWNLOAD')).toBe(true);
    expect(hasPermission('DEVELOPER', 'DIAGNOSTIC_DELETE')).toBe(false);
    expect(hasPermission('DEBUG_ADMIN', 'DIAGNOSTIC_DELETE')).toBe(true);
    expect(hasPermission('DEBUG_ADMIN', 'RETENTION_MANAGE')).toBe(false);
    expect(hasPermission('SUPER_ADMIN', 'FORCE_DELETE')).toBe(true);
  });
  it('no role → nothing', () => {
    expect(hasPermission(null, 'LOG_VIEW')).toBe(false);
  });
});

describe('artifacts + bundle', () => {
  it('validates magic bytes, rejects executables', () => {
    expect(sniffArtifact('DUMP', new Uint8Array([0x4d, 0x44, 0x4d, 0x50, 1]))).toBe('application/x-dmp');
    expect(sniffArtifact('DUMP', new Uint8Array([0x4d, 0x5a, 0x90]))).toBeNull();
    expect(sniffArtifact('SCREENSHOT', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffArtifact('LOG', new Uint8Array([0x4d, 0x5a, 0x41]))).toBeNull();
    expect(sniffArtifact('LOG', new TextEncoder().encode('hello'))).toBe('text/plain');
  });
  it('zip entry names cannot traverse', () => {
    expect(safeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('C:\\Windows\\..\\x')).toBe('C_/Windows/x');
    expect(safeEntryName('\\\\server\\share\\a')).toBe('server/share/a');
  });
  it('builds a valid zip', () => {
    const z = buildZip([{ name: 'README.txt', data: 'hi' }, { name: 'events.json', data: '[]' }]);
    expect([z[0], z[1], z[2], z[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('crash codes are readable', () => {
    expect(crashCode('3f9a1bcd-0000-0000-0000-000000000000', now)).toBe('CR-20261008-3F9A1');
  });
  it('categories resolve', () => {
    expect(categoryOf('API_TIMEOUT')).toBe('API');
    expect(categoryOf('nope')).toBeNull();
  });
});
