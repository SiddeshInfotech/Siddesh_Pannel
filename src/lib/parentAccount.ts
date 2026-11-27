import 'server-only';
import { z } from 'zod';
import type { PanelTable } from './panelTables';

// ============================================================================
// Accounts → Parents: checking an edit, and removing a parent with every row linked to it.
// The pop-up checks the same things, but only these server-side checks count.
// ============================================================================

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NO_TAGS = /^[^<>]*$/;
// "1"–"12" from the form, or what the website writes for a buyer: "Grade 3", "1 to 4".
const GRADE = /^[A-Za-z0-9 \-]*$/;

/** The website keeps names to 100 characters (panel_update_profile). */
export const WEBSITE_NAME_MAX = 100;

const ParentEditSchema = z.object({
  parentName: z.string().trim().min(1, 'Parent Name is required.').max(150, 'Parent Name is too long.').regex(NO_TAGS, 'Parent Name cannot contain < or >.'),
  kidName: z.string().trim().min(1, "Kid's Name is required.").max(150, "Kid's Name is too long.").regex(NO_TAGS, "Kid's Name cannot contain < or >."),
  email: z.string().trim().max(254, 'Email Address is too long.').regex(EMAIL, 'Enter a valid Email Address.'),
  phoneNumber: z.string().trim().max(20, 'Enter a valid Mobile Number (10 digits).'),
  grade: z.string().trim().max(50, 'Grade is too long.').regex(GRADE, 'Select a valid Grade.').optional().default(''),
  status: z.enum(['Active', 'Inactive'], { message: 'Status must be Active or Inactive.' }),
  city: z.string().trim().max(100, 'City is too long.').regex(NO_TAGS, 'City cannot contain < or >.').optional().default(''),
  state: z.string().trim().max(100, 'State is too long.').regex(NO_TAGS, 'State cannot contain < or >.').optional().default(''),
});

export interface ParentEdit {
  parentName: string;
  kidName: string;
  email: string;
  /** 10 digits, no country code. */
  phoneNumber: string;
  grade: string;
  status: 'Active' | 'Inactive';
  city: string;
  state: string;
}

/** 10-digit Indian mobile from what was typed: spaces, dashes, brackets, +91 or a leading 0 allowed. */
export function cleanMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '').replace(/^(?:\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[0-9]{10}$/.test(digits) ? digits : null;
}

/**
 * Checks an Edit Parent form. `websiteLinked`: the parent is also an LMS School website account,
 * whose profile takes the name (100 characters at most) and an Indian mobile number (starts 6–9).
 */
export function parseParentEdit(input: unknown, opts: { websiteLinked: boolean }): { ok: true; data: ParentEdit } | { ok: false; error: string } {
  const parsed = ParentEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the form and try again.' };
  const v = parsed.data;
  const phone = cleanMobile(v.phoneNumber);
  if (!phone) return { ok: false, error: 'Enter a valid Mobile Number (10 digits).' };
  if (opts.websiteLinked) {
    if (v.parentName.length > WEBSITE_NAME_MAX) return { ok: false, error: `Parent Name can be at most ${WEBSITE_NAME_MAX} characters for a website account.` };
    if (!/^[6-9]/.test(phone)) return { ok: false, error: 'Enter a valid Indian mobile number (starting 6–9).' };
  }
  return { ok: true, data: { ...v, email: v.email.toLowerCase(), phoneNumber: phone } };
}

// ---- Delete ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | null; error: { message: string; code?: string } | null };
/** The part of the Supabase query builder used here (also faked in the unit tests). */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CleanupDb { from: (table: PanelTable) => any }
export interface ExtraDeviceTables { from: (table: 'device_update_status' | 'device_content_status') => any }
/* eslint-enable @typescript-eslint/no-explicit-any */

const PAGE = 1000;
const CHUNK = 100;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

class CleanupError extends Error {
  constructor(readonly step: string, message: string) { super(message); }
}

async function readAll(step: string, page: (from: number, to: number) => PromiseLike<QueryResult>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new CleanupError(step, error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function run(step: string, query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new CleanupError(step, error.message);
}

const strings = (rows: Row[], column: string) =>
  [...new Set(rows.map((r) => r[column]).filter((v): v is string => typeof v === 'string' && v.length > 0))];

export interface CleanupSummary { keys: number; payments: number; devices: number }

/**
 * Removes one parent from the panel database with everything linked to it, children first so no
 * foreign key blocks a step: bindings and logs of its keys, its PCs' records (only PCs no other
 * account's key uses), its keys, its payments, then the parent row. Every step deletes by owner,
 * so running it again after a failure finishes the job.
 * `extra`: LMS-Admin's update and content rollout status per PC (Lab-Admin has no such tables).
 */
export async function deleteParentRecords(db: CleanupDb, parentId: string, extra: ExtraDeviceTables | null):
  Promise<{ ok: true; summary: CleanupSummary } | { ok: false; step: string; message: string }> {
  if (!UUID.test(parentId)) return { ok: false, step: 'input', message: 'invalid parent id' };
  try {
    const [keys, statusRows, payments] = await Promise.all([
      readAll('read keys', (from, to) => db.from('activation_keys').select('id, key, device_fingerprint').eq('parent_id', parentId).order('id').range(from, to)),
      readAll('read devices', (from, to) => db.from('device_status').select('device_fingerprint').eq('parent_id', parentId).order('id').range(from, to)),
      readAll('read payments', (from, to) => db.from('payments').select('id').eq('parent_id', parentId).order('id').range(from, to)),
    ]);
    const keyIds = strings(keys, 'id');
    const keyValues = strings(keys, 'key');
    const fingerprints = [...new Set([...strings(keys, 'device_fingerprint'), ...strings(statusRows, 'device_fingerprint')])];

    // A PC another account's key also runs on keeps its records.
    const shared = new Set<string>();
    for (const part of chunks(fingerprints)) {
      const rows = await readAll('read shared devices', (from, to) => db.from('activation_keys').select('device_fingerprint')
        .in('device_fingerprint', part).or(`parent_id.is.null,parent_id.neq.${parentId}`).order('id').range(from, to));
      for (const fp of strings(rows, 'device_fingerprint')) shared.add(fp);
    }
    const ownDevices = fingerprints.filter((fp) => !shared.has(fp));

    for (const part of chunks(keyIds)) await run('key bindings', db.from('revoked_device_bindings').delete().in('activation_key_id', part));
    for (const part of chunks(keyValues)) await run('key logs', db.from('handshake_logs').delete().in('activation_key', part));
    for (const part of chunks(ownDevices)) {
      for (const table of ['handshake_logs', 'terms_acceptances', 'device_daily_online', 'device_timeline', 'device_status'] as const) {
        await run(`device ${table}`, db.from(table).delete().in('device_fingerprint', part));
      }
      if (extra) {
        for (const table of ['device_update_status', 'device_content_status'] as const) {
          await run(`device ${table}`, extra.from(table).delete().in('device_fingerprint', part));
        }
      }
    }
    await run('device timeline', db.from('device_timeline').delete().eq('parent_id', parentId));
    await run('device status', db.from('device_status').delete().eq('parent_id', parentId));
    await run('keys', db.from('activation_keys').delete().eq('parent_id', parentId));
    await run('payments', db.from('payments').delete().eq('parent_id', parentId));
    await run('parent', db.from('parents').delete().eq('id', parentId));
    return { ok: true, summary: { keys: keyIds.length, payments: payments.length, devices: ownDevices.length } };
  } catch (err) {
    if (err instanceof CleanupError) return { ok: false, step: err.step, message: err.message };
    throw err;
  }
}
