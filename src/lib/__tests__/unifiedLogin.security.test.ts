import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPKCS8, generateKeyPair, SignJWT, decodeJwt, type CryptoKey } from 'jose';

// In-memory tables. The lab client reads `lab_*` tables of the same database.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const touched: string[] = [];

function builder(table: string) {
  touched.push(table);
  let rows = [...(tables[table] ?? [])];
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (col: string, val: unknown) => { rows = rows.filter(r => r[col] === val); return q; },
    ilike: (col: string, val: string) => { rows = rows.filter(r => String(r[col]).toLowerCase() === val.toLowerCase()); return q; },
    insert: async () => ({ error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: rows, error: null }),
  };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: builder, rpc: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

let auth: typeof import('../auth');
let privateKey: CryptoKey;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  process.env.ADMIN_JWT_PRIVATE_KEY = await exportPKCS8(pair.privateKey);
  auth = await import('../auth');
});

const future = () => new Date(Date.now() + 3600_000).toISOString();

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  touched.length = 0;
});

/** A token signed with the real key but crafted claims (what an insider/bug could produce). */
async function craft(claims: Record<string, unknown>) {
  const { payload } = { payload: decodeJwt(await auth.signAdminToken('a@x.com', 'sid-1', 'lms')) };
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setIssuer(payload.iss as string)
    .setAudience(payload.aud as string)
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('session token: panel comes only from the signed claim', () => {
  it('a Lab session is checked against the Lab session table only', async () => {
    tables.lab_admin_sessions = [{ session_id: 'sid-lab', revoked: false, expires_at: future() }];
    const token = await auth.signAdminToken('lab@x.com', 'sid-lab', 'lab');
    expect((await auth.verifyAdminToken(token))?.panel).toBe('lab');
    expect(touched).toContain('lab_admin_sessions');
    expect(touched).not.toContain('admin_sessions');
  });

  it('a Lab session id is not valid as an LMS session (no cross-panel reuse)', async () => {
    tables.lab_admin_sessions = [{ session_id: 'sid-lab', revoked: false, expires_at: future() }];
    const token = await auth.signAdminToken('lab@x.com', 'sid-lab', 'lms');
    expect(await auth.verifyAdminToken(token)).toBeNull();
  });

  it('rejects a token with no panel claim instead of defaulting to LMS', async () => {
    tables.admin_sessions = [{ session_id: 'sid-1', revoked: false, expires_at: future() }];
    const token = await craft({ email: 'a@x.com', role: 'administrator', sid: 'sid-1', purpose: 'admin-session' });
    expect(await auth.verifyAdminToken(token)).toBeNull();
  });

  it('rejects an unknown panel value', async () => {
    tables.admin_sessions = [{ session_id: 'sid-1', revoked: false, expires_at: future() }];
    const token = await craft({ email: 'a@x.com', role: 'administrator', sid: 'sid-1', purpose: 'admin-session', panel: 'root' });
    expect(await auth.verifyAdminToken(token)).toBeNull();
  });

  it('rejects an unsigned alg:none token', async () => {
    const signed = await auth.signAdminToken('a@x.com', 'sid-1', 'lab');
    const [, body] = signed.split('.');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`;
    expect(await auth.verifyAdminToken(none)).toBeNull();
  });

  it('rejects a revoked session even with a valid signature', async () => {
    tables.lab_admin_sessions = [{ session_id: 'sid-lab', revoked: true, expires_at: future() }];
    expect(await auth.verifyAdminToken(await auth.signAdminToken('lab@x.com', 'sid-lab', 'lab'))).toBeNull();
  });

  it('a pre-MFA challenge token never works as a session', async () => {
    expect(await auth.verifyAdminToken(await auth.signChallengeToken('a@x.com', 'n', 'lab'))).toBeNull();
  });
});

describe('MFA challenge token', () => {
  it('lives exactly 1 minute and carries the panel', async () => {
    const t = await auth.signChallengeToken('a@x.com', 'n', 'lab');
    const p = decodeJwt(t);
    expect((p.exp as number) - (p.iat as number)).toBe(60);
    expect((await auth.verifyChallengeToken(t)).panel).toBe('lab');
  });

  it('is refused without a panel claim', async () => {
    const t = await craft({ email: 'a@x.com', purpose: 'mfa-challenge', nonce: 'n' });
    expect((await auth.verifyChallengeToken(t)).error).toBeTruthy();
  });
});

describe('universal sign-in lookup', () => {
  it('finds a Lab admin and reports the Lab panel', async () => {
    tables.lab_admin_users = [{ email: 'lab@x.com' }];
    const r = await auth.findAdminAccount('lab@x.com');
    expect(r.panel).toBe('lab');
    expect(r.user?.email).toBe('lab@x.com');
  });

  it('finds an LMS admin and reports the LMS panel', async () => {
    tables.admin_users = [{ email: 'lms@x.com' }];
    expect((await auth.findAdminAccount('lms@x.com')).panel).toBe('lms');
  });

  it('refuses an email that exists in both panels', async () => {
    tables.admin_users = [{ email: 'both@x.com' }];
    tables.lab_admin_users = [{ email: 'both@x.com' }];
    const r = await auth.findAdminAccount('both@x.com');
    expect(r.user).toBeNull();
    expect(r.panel).toBeNull();
    expect(r.error).toBe('Ambiguous account');
  });

  it('always queries both tables, so timing does not reveal the panel', async () => {
    tables.admin_users = [{ email: 'lms@x.com' }];
    await auth.findAdminAccount('lms@x.com');
    expect(touched).toEqual(expect.arrayContaining(['admin_users', 'lab_admin_users']));
  });
});
