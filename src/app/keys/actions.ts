'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { z } from 'zod';
import { randomInt } from 'crypto';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { indianAcademicYear } from '@/lib/entity';
import { PRODUCT_ID_ENUM, DEFAULT_PRODUCT_ID, productDisplayName, isProductId } from '@/lib/productIdentity';
import {
  DEVICE_CLASS_ENUM,
  DEVICE_CLASS_STANDARD,
  DEVICE_CLASS_MANAGED_PANEL,
  deviceClassAllowedFor,
  isMissingColumnError,
  isPanelKey,
  DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS,
  MAX_PANEL_ACTIVATION_WINDOW_DAYS,
  PANEL_MIGRATION_FILE,
  type DeviceClass,
} from '@/lib/deviceClass';

const DEVICE_CLASS_MIGRATION_MSG =
  `Interactive-panel keys need a one-time database update. Run ${PANEL_MIGRATION_FILE} in Supabase, then try again.`;

function panelWindowEnd(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Activation key format: LMS-<SCHOOLCODE 2..12>-<CODE 10>. Rejects manually-typed
// junk like "LMS-SCHOOL-MNS7LGUAA4879898" (3rd segment must be exactly 10 chars).
const KEY_FORMAT = /^LMS-[A-Z0-9]{2,12}-[A-Z0-9]{10}$/;

// Activation keys are CREDENTIALS. For a bulk batch the SERVER mints them here with a
// CSPRNG (crypto.randomInt is unbiased over this 32-symbol alphabet ≈ 50 bits of
// entropy) — identical scheme to payments/actions.ts — so thousands of credentials are
// never sourced from, or predictable to, anything running in the operator's browser.
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateActivationCode(len = 10): string {
  let s = '';
  for (let i = 0; i < len; i++) s += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return s;
}

/** Entity-name prefix for a minted key, constrained to KEY_FORMAT's [A-Z0-9]{2,12}. */
function keyPrefixFor(entityName: string): string {
  const cleaned = entityName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 8);
  return cleaned.length >= 2 ? cleaned : 'ENTITY';
}

const ActivationKeySchema = z.object({
  entityType: z.enum(['School', 'Vendor', 'Individual']),
  schoolId: z.string().optional(),
  vendorId: z.string().optional(),
  parentId: z.string().optional(),
  // Explicit keys — the operator-typed single key, and the existing small auto-filled
  // runs. Unchanged.
  keys: z.array(z.string().trim().regex(KEY_FORMAT, 'Invalid activation key format.'))
    .min(1, 'Provide at least one key.')
    .max(10000, 'Too many keys requested.')
    .optional(),
  // Bulk batch — the client sends only HOW MANY; the server mints the key values.
  generateCount: z.number({ message: 'Batch count must be a number.' })
    .int('Batch count must be a whole number.')
    .min(1, 'Generate at least 1 key.')
    .max(10000, 'Too many keys requested.')
    .optional(),
  durationDays: z.number({ message: 'Duration must be a number.' }).int('Duration must be a whole number.').min(1, 'Duration must be at least 1 day.').max(36500, 'Duration is too large.'),
  expiresAt: z.string().optional(),
  // Which product this batch of keys is for (src/lib/productIdentity.ts). Defaults to
  // LMS School Android — the existing production behavior — for any caller that omits it.
  productId: z.enum(PRODUCT_ID_ENUM).default(DEFAULT_PRODUCT_ID),
  // Standard (phones / tablets, full security) vs Interactive panel (src/lib/deviceClass.ts).
  // Defaults to Standard for any caller that omits it — existing behavior.
  deviceClass: z.enum(DEVICE_CLASS_ENUM).default(DEVICE_CLASS_STANDARD),
  // Interactive panel only: an unused panel key dies after this many days (bounds how long a
  // leaked, unused panel key stays exploitable). Ignored for Standard keys.
  activateWithinDays: z.number({ message: 'Activation window must be a number.' })
    .int('Activation window must be a whole number of days.')
    .min(1, 'Activation window must be at least 1 day.')
    .max(MAX_PANEL_ACTIVATION_WINDOW_DAYS, `Activation window can be at most ${MAX_PANEL_ACTIVATION_WINDOW_DAYS} days.`)
    .default(DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS),
}).refine(
  data => deviceClassAllowedFor(data.productId, data.deviceClass),
  { message: 'Interactive-panel keys are only available for Android products.' }
).refine(data => {
  if (data.entityType === 'School' && !data.schoolId) return false;
  if (data.entityType === 'Vendor' && !data.vendorId) return false;
  if (data.entityType === 'Individual' && !data.parentId) return false;
  return true;
}, { message: 'Select an entity.' }).refine(
  data => (data.keys !== undefined) !== (data.generateCount !== undefined),
  { message: 'Provide exactly one of: explicit keys, or a batch count.' }
);

// Batch key generation (Vendor) can request up to the schema's 10,000-row cap in one
// call. A single INSERT statement that large risks the request/response payload size
// and statement-complexity limits Supabase/PostgREST impose — a failure there would
// surface as an opaque 500 with no rows created. Chunking removes that risk entirely.
// For every EXISTING caller (School/Individual/small Vendor batches, always well under
// this size) this is still exactly one INSERT, so there is no behavioral change today.
const INSERT_CHUNK_SIZE = 500;

async function insertKeysInChunks(
  rows: any[] /* eslint-disable-line @typescript-eslint/no-explicit-any */
): Promise<{ data: any[] | null; error: { code?: string; message: string } | null }> /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
  const created: any[] = []; /* eslint-disable-line @typescript-eslint/no-explicit-any */
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    // Select only what the caller actually maps back (CreatedKey). A bare .select()
    // returns every column of every row — ~25 columns x up to 10,000 rows of pure
    // transfer cost for 7 fields of use.
    const { data, error } = await supabaseAdmin
      .from('activation_keys')
      .insert(chunk)
      .select('id, key, status, duration_days, expires_at, batch_id');
    if (error) {
      // Rows from earlier chunks in this same call are already committed (each INSERT
      // is its own transaction) — surfacing the error is correct; the caller's existing
      // unique-violation handling (error.code === '23505') still applies per-chunk.
      return { data: created.length > 0 ? created : null, error };
    }
    if (data) created.push(...data);
  }
  return { data: created, error: null };
}

type CreatedKey = {
  id: string;
  key: string;
  status: string;
  durationDays: number;
  expiresAt: string | null;
  createdAt: string;
  batchId: string | null;
};

export async function createActivationKeys(formData: any /* eslint-disable-line @typescript-eslint/no-explicit-any */): Promise<ActionResult<CreatedKey[]>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  const parsed = ActivationKeySchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'CREATE_KEYS_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }

  const validData = parsed.data;

  try {
    // Business rule: the entity must have an approved (Paid) payment before keys issue.
    const paymentQuery = supabaseAdmin.from('payments').select('id').eq('status', 'Paid').limit(1);
    
    if (validData.entityType === 'School') {
      paymentQuery.eq('school_id', validData.schoolId);
    } else if (validData.entityType === 'Vendor') {
      paymentQuery.eq('vendor_id', validData.vendorId);
    } else if (validData.entityType === 'Individual') {
      paymentQuery.eq('parent_id', validData.parentId);
    }

    const { data: payment } = await paymentQuery.single();

    if (!payment) {
      return fail(`No approved payment for this ${validData.entityType}. Register and approve a 'Paid' payment first.`);
    }

    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // The operator has just chosen this key's validity (duration/expiry) above. Capture
    // the academic year of that window NOW and store it on the key, so activation can
    // show & maintain the year the operator picked (used for the vendor's "Year").
    const academicYear = indianAcademicYear(validData.expiresAt ? new Date(validData.expiresAt) : new Date());

    // Batch mode: mint the key values HERE, from the entity's real name as recorded in
    // the database — never from a client-supplied name or client-supplied key values.
    let keyValues: string[];
    if (validData.generateCount !== undefined) {
      let entityName = 'ENTITY';
      if (validData.entityType === 'School') {
        const { data: school } = await supabaseAdmin.from('schools').select('name').eq('id', validData.schoolId).single();
        if (school?.name) entityName = school.name;
      } else if (validData.entityType === 'Vendor') {
        const { data: vendor } = await supabaseAdmin.from('vendors').select('vendor_name').eq('vendor_id', validData.vendorId).single();
        if (vendor?.vendor_name) entityName = vendor.vendor_name;
      } else if (validData.entityType === 'Individual') {
        const { data: parent } = await supabaseAdmin.from('parents').select('parent_name').eq('id', validData.parentId).single();
        if (parent?.parent_name) entityName = parent.parent_name;
      }
      const prefix = keyPrefixFor(entityName);
      keyValues = Array.from({ length: validData.generateCount }, () => `LMS-${prefix}-${generateActivationCode()}`);
    } else {
      keyValues = validData.keys ?? [];
    }

    const insertRows = keyValues.map(keyVal => ({
      school_id: validData.entityType === 'School' ? validData.schoolId : null,
      vendor_id: validData.entityType === 'Vendor' ? validData.vendorId : null,
      parent_id: validData.entityType === 'Individual' ? validData.parentId : null,
      key: keyVal,
      duration_days: validData.durationDays,
      expires_at: validData.expiresAt ? new Date(validData.expiresAt).toISOString() : null,
      academic_year: academicYear,
      status: 'Paid' as const,
      batch_id: batchId,
      product_id: validData.productId,
      // Only written for panel keys, so Standard key generation never depends on the
      // device_class column (works on a DB that hasn't run add_interactive_panel.sql yet).
      ...(validData.deviceClass === DEVICE_CLASS_MANAGED_PANEL
        ? { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: panelWindowEnd(validData.activateWithinDays) }
        : {}),
    }));

    const { data: createdKeys, error } = await insertKeysInChunks(insertRows);

    if (error) {
      logger.error({ event: 'CREATE_KEYS_DB_ERROR', code: error.code, created: createdKeys?.length ?? 0 }, error);
      if (validData.deviceClass === DEVICE_CLASS_MANAGED_PANEL && isMissingColumnError(error) && !createdKeys?.length) {
        return fail(DEVICE_CLASS_MIGRATION_MSG);
      }
      // A large batch chunks into several INSERTs — if an earlier chunk already
      // committed before a later one failed, those rows are real and already in the
      // database, so still make them visible instead of leaving the admin unsure.
      if (createdKeys && createdKeys.length > 0) {
        revalidatePath('/keys');
        revalidatePath('/data');
      }
      if (error.code === '23505') return fail('One or more of these keys already exist.');
      return fail(GENERIC_ERROR);
    }

    if (validData.entityType === 'School') {
      await supabaseAdmin.from('schools').update({ status: 'Active' }).eq('id', validData.schoolId);
    } else if (validData.entityType === 'Vendor') {
      await supabaseAdmin.from('vendors').update({ status: 'Active' }).eq('vendor_id', validData.vendorId);
    } else if (validData.entityType === 'Individual') {
      await supabaseAdmin.from('parents').update({ status: 'Active' }).eq('id', validData.parentId);
    }

    logger.info({
      event: 'ACTIVATION_KEYS_CREATED',
      batchId,
      keysCount: keyValues.length,
      serverMinted: validData.generateCount !== undefined,
      deviceClass: validData.deviceClass,
      adminEmail: session.email,
    });
    revalidatePath('/keys');
    revalidatePath('/data');

    return ok((createdKeys ?? []).map(k => ({
      id: k.id,
      key: k.key,
      status: k.status || 'Paid',
      durationDays: k.duration_days || 365,
      expiresAt: k.expires_at ?? null,
      createdAt: new Date().toLocaleDateString('en-IN'),
      batchId: k.batch_id ?? null,
    })));
  } catch (err: unknown) {
    logger.error({ event: 'CREATE_KEYS_CRITICAL_ERROR' }, err);
    return fail(GENERIC_ERROR);
  }
}

// Reset device binding so a REPAIRED / FACTORY-RESET tablet (whose hardware
// fingerprint changed) can re-activate the same key. SECURITY:
//   • Admin-only + audit-logged.
//   • expires_at / duration_days are NOT touched — a re-bind is NOT a free renewal.
//   • An already-expired key still can't be revived (the activation route blocks it).
export async function resetDeviceBinding(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    const { data: existing } = await supabaseAdmin
      .from('activation_keys')
      .select('device_fingerprint, status')
      .eq('id', id)
      .single();

    // Interactive-panel key (best-effort read: before the migration no key is a panel key).
    const { data: panelRow } = await supabaseAdmin
      .from('activation_keys')
      .select('device_class')
      .eq('id', id)
      .maybeSingle();
    const panel = isPanelKey(panelRow);

    // Panel keys: the device being replaced must actually stop. Record the old (key, device)
    // pair so /api/device/ping answers it kill:true (its licence + keys are purged on its next
    // online heartbeat — an offline device keeps its signed licence until it comes online or
    // the licence expires). Done BEFORE clearing the binding: if it can't be recorded, the
    // reset is refused rather than silently leaving the old panel working.
    if (panel && existing?.device_fingerprint) {
      const { error: rbError } = await supabaseAdmin
        .from('revoked_device_bindings')
        .upsert({
          activation_key_id: id,
          device_fingerprint: existing.device_fingerprint,
          reason: 'reset',
          revoked_by: session.email,
          revoked_at: new Date().toISOString(),
        }, { onConflict: 'activation_key_id,device_fingerprint' });
      if (rbError) {
        if (isMissingColumnError(rbError)) return fail(DEVICE_CLASS_MIGRATION_MSG);
        logger.error({ event: 'RESET_PANEL_REVOKE_OLD_DEVICE_FAILED', keyId: id }, rbError);
        return fail(GENERIC_ERROR);
      }
    }

    const { error } = await supabaseAdmin
      .from('activation_keys')
      .update({
        device_fingerprint: null,
        device_model: null,
        device_os: null,
        device_board: null,
        device_brand: null,
        device_device: null,
        device_manufacturer: null,
        device_android_id: null,
        activated_at: null,
        last_known_monotonic_time: null,
        status: 'Paid',
      })
      .eq('id', id);

    if (error) {
      logger.error({ event: 'RESET_DEVICE_BINDING_DB_ERROR', keyId: id }, error);
      return fail(GENERIC_ERROR);
    }

    // Panel keys: drop the old device key + proof-of-possession state, and re-open a fresh
    // activation window so the replacement panel can use the key.
    if (panel) {
      const { error: pError } = await supabaseAdmin
        .from('activation_keys')
        .update({
          device_wrap_pubkey: null,
          pop_challenge_hash: null,
          pop_prev_hash: null,
          pop_failures: 0,
          pop_last_ok_at: null,
          enrollment_expires_at: panelWindowEnd(DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS),
        })
        .eq('id', id);
      if (pError) logger.warn({ event: 'RESET_PANEL_STATE_CLEAR_FAILED', keyId: id, error: pError.message });
    }

    logger.info({
      event: panel ? 'PANEL_BINDING_RESET' : 'RESET_DEVICE_BINDING',
      keyId: id,
      adminEmail: session.email,
      previousFingerprint: existing?.device_fingerprint ?? null,
      previousStatus: existing?.status ?? null,
    });
    revalidatePath('/keys');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'RESET_DEVICE_BINDING_CRITICAL_ERROR', keyId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

// Change an existing key between Standard and Interactive panel (e.g. keys generated before
// this option existed). SECURITY: admin-only + audit-logged; Android products only. Takes
// effect at the key's NEXT activation — an already-activated device keeps the licence it was
// signed at activation, so to apply it to a bound device use Reset Device Binding as well.
export async function setKeyDeviceClass(id: string, deviceClass: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);
  if (!(DEVICE_CLASS_ENUM as readonly string[]).includes(deviceClass)) return fail(GENERIC_ERROR);
  const next = deviceClass as DeviceClass;

  try {
    const { data: existing, error: readError } = await supabaseAdmin
      .from('activation_keys')
      .select('product_id')
      .eq('id', id)
      .single();
    if (readError || !existing) return fail(GENERIC_ERROR);

    const productId = isProductId(existing.product_id) ? existing.product_id : DEFAULT_PRODUCT_ID;
    if (!deviceClassAllowedFor(productId, next)) {
      return fail(`Interactive-panel keys are only available for Android products (this key is ${productDisplayName(productId)}).`);
    }

    const { error } = await supabaseAdmin
      .from('activation_keys')
      .update(next === DEVICE_CLASS_MANAGED_PANEL
        // A key switched to panel gets a fresh activation window (applies only while unbound).
        ? { device_class: DEVICE_CLASS_MANAGED_PANEL, enrollment_expires_at: panelWindowEnd(DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS) }
        : { device_class: null, enrollment_expires_at: null })
      .eq('id', id);

    if (error) {
      if (isMissingColumnError(error)) return fail(DEVICE_CLASS_MIGRATION_MSG);
      logger.error({ event: 'SET_KEY_DEVICE_CLASS_DB_ERROR', keyId: id }, error);
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'SET_KEY_DEVICE_CLASS', keyId: id, deviceClass: next, adminEmail: session.email });
    revalidatePath('/keys');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'SET_KEY_DEVICE_CLASS_CRITICAL_ERROR', keyId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function deleteActivationKey(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    const { error } = await supabaseAdmin
      .from('activation_keys')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_KEY_DB_ERROR', keyId: id }, error);
      return fail(GENERIC_ERROR);
    }
    logger.info({ event: 'ACTIVATION_KEY_DELETED', keyId: id, adminEmail: session.email });
    revalidatePath('/keys');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_KEY_CRITICAL_ERROR', keyId: id }, err);
    return fail(GENERIC_ERROR);
  }
}
