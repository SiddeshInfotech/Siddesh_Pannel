import { describe, expect, it } from 'vitest';
import { cleanMobile, deleteParentRecords, parseParentEdit, type CleanupDb } from '../parentAccount';

const PARENT = '3f2b6c1e-8a4d-4b7e-9c21-5d6e7f8a9b0c';

const valid = {
  parentName: '  Ram Gulave ',
  kidName: 'Aryan Gulave',
  email: 'Ram.Gulave@Example.com',
  phoneNumber: '+91 93077-87825',
  grade: '1',
  status: 'Active',
  city: 'Dhule',
  state: 'Maharashtra',
};

describe('parseParentEdit', () => {
  it('trims, lower-cases the email and keeps 10 digits of the mobile', () => {
    const r = parseParentEdit(valid, { websiteLinked: false });
    expect(r).toEqual({ ok: true, data: { ...valid, parentName: 'Ram Gulave', email: 'ram.gulave@example.com', phoneNumber: '9307787825' } });
  });

  it.each([
    [{ parentName: '' }, 'Parent Name is required.'],
    [{ parentName: 'x'.repeat(151) }, 'Parent Name is too long.'],
    [{ kidName: '   ' }, "Kid's Name is required."],
    [{ kidName: '<script>' }, "Kid's Name cannot contain < or >."],
    [{ email: 'not-an-email' }, 'Enter a valid Email Address.'],
    [{ email: `${'a'.repeat(250)}@x.com` }, 'Email Address is too long.'],
    [{ phoneNumber: '12345' }, 'Enter a valid Mobile Number (10 digits).'],
    [{ phoneNumber: '9'.repeat(21) }, 'Enter a valid Mobile Number (10 digits).'],
    [{ grade: 'x'.repeat(51) }, 'Grade is too long.'],
    [{ grade: 'Grade; drop' }, 'Select a valid Grade.'],
    [{ status: 'Deleted' }, 'Status must be Active or Inactive.'],
    [{ city: 'c'.repeat(101) }, 'City is too long.'],
    [{ state: '<b>' }, 'State cannot contain < or >.'],
  ])('rejects %j', (change, message) => {
    expect(parseParentEdit({ ...valid, ...change }, { websiteLinked: false })).toEqual({ ok: false, error: message });
  });

  it('rejects input that is not a form', () => {
    expect(parseParentEdit(null, { websiteLinked: false }).ok).toBe(false);
    expect(parseParentEdit({ ...valid, parentName: 42 }, { websiteLinked: false }).ok).toBe(false);
  });

  it('accepts the grades the website writes and an empty grade, city and state', () => {
    for (const grade of ['Grade 3', '1 to 4', '']) expect(parseParentEdit({ ...valid, grade }, { websiteLinked: false }).ok).toBe(true);
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.city;
    delete rest.state;
    delete rest.grade;
    expect(parseParentEdit(rest, { websiteLinked: false })).toMatchObject({ ok: true, data: { city: '', state: '', grade: '' } });
  });

  it('holds a website account to the website profile rules', () => {
    expect(parseParentEdit({ ...valid, parentName: 'n'.repeat(101) }, { websiteLinked: true })).toEqual({ ok: false, error: 'Parent Name can be at most 100 characters for a website account.' });
    expect(parseParentEdit({ ...valid, parentName: 'n'.repeat(101) }, { websiteLinked: false }).ok).toBe(true);
    expect(parseParentEdit({ ...valid, phoneNumber: '5307787825' }, { websiteLinked: true })).toEqual({ ok: false, error: 'Enter a valid Indian mobile number (starting 6–9).' });
    expect(parseParentEdit({ ...valid, phoneNumber: '5307787825' }, { websiteLinked: false }).ok).toBe(true);
  });
});

describe('cleanMobile', () => {
  it.each([
    ['9307787825', '9307787825'],
    ['+919307787825', '9307787825'],
    ['91 93077 87825', '9307787825'],
    ['09307787825', '9307787825'],
    ['(930) 778-7825', '9307787825'],
    ['9123456789', '9123456789'],
    ['930778782', null],
    ['93077878251', null],
    ['abcdefghij', null],
  ])('%s → %s', (raw, expected) => expect(cleanMobile(raw)).toBe(expected));
});

// ---- deleteParentRecords against a fake query builder that records every call ----

type Call = { table: string; op: 'select' | 'delete'; filters: string[] };

function fakeDb(rows: Record<string, Record<string, unknown>[]>, failOn?: string) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    const q = {
      select: () => q,
      delete: () => { call.op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { call.filters.push(`${c}=${v}`); return q; },
      in: (c: string, v: unknown[]) => { call.filters.push(`${c} in ${v.join(',')}`); return q; },
      or: (f: string) => { call.filters.push(`or(${f})`); return q; },
      order: () => q,
      range: () => q,
      then: (resolve: (r: unknown) => unknown) => {
        calls.push(call);
        const key = `${call.op} ${table}`;
        if (failOn === key) return resolve({ data: null, error: { message: 'violates foreign key constraint' } });
        const data = call.op === 'select'
          ? (call.filters.some((f) => f.startsWith('or(')) ? rows[`shared ${table}`] : rows[table]) ?? []
          : null;
        return resolve({ data, error: null });
      },
    };
    return q;
  };
  return { db: { from: builder } as unknown as CleanupDb, extra: { from: builder }, calls };
}

const deletes = (calls: Call[]) => calls.filter((c) => c.op === 'delete').map((c) => `${c.table} ${c.filters.join(' ')}`);

describe('deleteParentRecords', () => {
  const rows = {
    activation_keys: [
      { id: 'k1', key: 'AAAA-1111', device_fingerprint: 'pc-own' },
      { id: 'k2', key: 'BBBB-2222', device_fingerprint: 'pc-shared' },
      { id: 'k3', key: 'CCCC-3333', device_fingerprint: null },
    ],
    device_status: [{ device_fingerprint: 'pc-own' }, { device_fingerprint: 'pc-old' }],
    payments: [{ id: 'p1' }, { id: 'p2' }],
    // Another account's key also runs on pc-shared.
    'shared activation_keys': [{ device_fingerprint: 'pc-shared' }],
  };

  it('deletes children before parents and leaves a shared PC alone', async () => {
    const { db, extra, calls } = fakeDb(rows);
    const result = await deleteParentRecords(db, PARENT, extra);
    expect(result).toEqual({ ok: true, summary: { keys: 3, payments: 2, devices: 2 } });

    const shared = calls.find((c) => c.filters.some((f) => f.startsWith('or(')));
    expect(shared?.filters).toEqual(['device_fingerprint in pc-own,pc-shared,pc-old', `or(parent_id.is.null,parent_id.neq.${PARENT})`]);

    expect(deletes(calls)).toEqual([
      'revoked_device_bindings activation_key_id in k1,k2,k3',
      'handshake_logs activation_key in AAAA-1111,BBBB-2222,CCCC-3333',
      'handshake_logs device_fingerprint in pc-own,pc-old',
      'terms_acceptances device_fingerprint in pc-own,pc-old',
      'device_daily_online device_fingerprint in pc-own,pc-old',
      'device_timeline device_fingerprint in pc-own,pc-old',
      'device_status device_fingerprint in pc-own,pc-old',
      'device_update_status device_fingerprint in pc-own,pc-old',
      'device_content_status device_fingerprint in pc-own,pc-old',
      `device_timeline parent_id=${PARENT}`,
      `device_status parent_id=${PARENT}`,
      `activation_keys parent_id=${PARENT}`,
      `payments parent_id=${PARENT}`,
      `parents id=${PARENT}`,
    ]);
  });

  it('skips the LMS-only PC tables for Lab-Admin', async () => {
    const { db, calls } = fakeDb(rows);
    await deleteParentRecords(db, PARENT, null);
    expect(deletes(calls).some((d) => d.startsWith('device_update_status') || d.startsWith('device_content_status'))).toBe(false);
  });

  it('deletes just the parent row when nothing is linked', async () => {
    const { db, extra, calls } = fakeDb({});
    expect(await deleteParentRecords(db, PARENT, extra)).toEqual({ ok: true, summary: { keys: 0, payments: 0, devices: 0 } });
    expect(deletes(calls)).toEqual([
      `device_timeline parent_id=${PARENT}`,
      `device_status parent_id=${PARENT}`,
      `activation_keys parent_id=${PARENT}`,
      `payments parent_id=${PARENT}`,
      `parents id=${PARENT}`,
    ]);
  });

  it('stops at the first failed step, before the parent row is touched', async () => {
    const { db, extra, calls } = fakeDb(rows, 'delete activation_keys');
    expect(await deleteParentRecords(db, PARENT, extra)).toEqual({ ok: false, step: 'keys', message: 'violates foreign key constraint' });
    expect(deletes(calls).some((d) => d.startsWith('payments') || d.startsWith('parents'))).toBe(false);
  });

  it('reports a failed read without deleting anything', async () => {
    const { db, extra, calls } = fakeDb(rows, 'select payments');
    expect(await deleteParentRecords(db, PARENT, extra)).toMatchObject({ ok: false, step: 'read payments' });
    expect(deletes(calls)).toEqual([]);
  });

  it('refuses an id that is not a UUID (it is placed in a filter string)', async () => {
    const { db, extra, calls } = fakeDb(rows);
    expect(await deleteParentRecords(db, `${PARENT},parent_id.neq.x`, extra)).toEqual({ ok: false, step: 'input', message: 'invalid parent id' });
    expect(calls).toEqual([]);
  });
});
