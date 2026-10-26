import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportPKCS8, generateKeyPair } from 'jose';
import { NextRequest } from 'next/server';

// The proxy's DB session check is stubbed: this file tests only the Server-Timing header.
const checkSessionInDb = vi.fn(async () => ({ live: true, expiresAt: Date.now() + 3600_000 }));
vi.mock('../auth', () => ({ COOKIE_NAME: 'admin_session', LEGACY_COOKIE_NAME: 'admin_token', checkSessionInDb }));

let proxy: (req: NextRequest) => Promise<Response>;
let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  process.env.AUTH_SERVER_TIMING = '1';
  const pair = await generateKeyPair('ES256', { extractable: true });
  process.env.ADMIN_JWT_PRIVATE_KEY = await exportPKCS8(pair.privateKey);
  sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setIssuedAt()
    .setIssuer('siddesh-lms-admin').setAudience('siddesh-lms-client').setExpirationTime('1h').sign(pair.privateKey);
  ({ proxy } = await import('../../proxy'));
});

const get = (path: string, token?: string) => proxy(new NextRequest(`http://localhost${path}`, {
  headers: token ? { cookie: `admin_session=${token}` } : {},
}));
const session = { email: 'a@x.com', role: 'administrator', sid: 'sid-timing', purpose: 'admin-session', panel: 'lab' };

describe('proxy Server-Timing', () => {
  it('sends no Server-Timing unless AUTH_SERVER_TIMING=1', async () => {
    delete process.env.AUTH_SERVER_TIMING;
    expect((await get('/lab-admin/keys', await sign({ ...session, sid: 'sid-off' }))).headers.get('server-timing')).toBeNull();
    process.env.AUTH_SERVER_TIMING = '1';
    checkSessionInDb.mockClear(); // the next test counts DB checks from zero
  });

  it('reports JWT and session-check cost on an authenticated request: miss, then hit', async () => {
    const token = await sign(session);
    const first = (await get('/lab-admin/keys', token)).headers.get('server-timing');
    expect(first).toMatch(/^proxy-jwt;dur=\d+\.\d{2}, proxy-session;dur=\d+\.\d{2};desc="miss"$/);
    const second = (await get('/lab-admin/keys', token)).headers.get('server-timing');
    expect(second).toContain('desc="hit"');
    expect(checkSessionInDb).toHaveBeenCalledTimes(1);
  });

  it('forwards a signed "verified" header to the page render only after the session check passes', async () => {
    const { isVerifiedFor } = await import('../verifiedHeader');
    const forged = 'forged.value';
    const res = await proxy(new NextRequest('http://localhost/lab-admin/keys', {
      headers: { cookie: `admin_session=${await sign(session)}`, 'x-admin-verified': forged },
    }));
    const forwarded = res.headers.get('x-middleware-request-x-admin-verified');
    expect(forwarded).not.toBe(forged);
    expect(isVerifiedFor(forwarded, { sid: session.sid, email: session.email, panel: 'lab' })).toBe(true);

    // Not signed in: a client-sent copy is dropped, never passed on.
    const anon = await proxy(new NextRequest('http://localhost/lab-admin/keys', { headers: { 'x-admin-verified': forged } }));
    expect(anon.headers.get('x-middleware-request-x-admin-verified')).toBeNull();
  });

  it('public routes match the exact path only, not every path that starts with it', async () => {
    for (const open of ['/lab-admin/api/ops/sync', '/lms-admin/api/device/ping', '/lab-admin/api/auth/login/']) {
      expect((await get(open)).status, open).not.toBe(401);
    }
    for (const closed of ['/lab-admin/api/ops/syncoverview', '/lab-admin/api/ops/sync/extra', '/lms-admin/api/seedx', '/lab-admin/api/activate2']) {
      expect((await get(closed)).status, closed).toBe(401);
    }
  });

  it('is never sent without a valid admin session', async () => {
    expect((await get('/lab-admin/keys')).headers.get('server-timing')).toBeNull();
    expect((await get('/lab-admin/api/x', 'not-a-jwt')).headers.get('server-timing')).toBeNull();
    const challenge = await sign({ email: 'a@x.com', purpose: 'mfa-challenge', panel: 'lab' });
    expect((await get('/lab-admin/keys', challenge)).headers.get('server-timing')).toBeNull();
  });
});
