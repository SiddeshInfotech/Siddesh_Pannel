'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { indianAcademicYear } from '@/lib/entity';
import { PRODUCT_ID_ENUM, DEFAULT_PRODUCT_ID } from '@/lib/productIdentity';

// Activation key format: LMS-<SCHOOLCODE 2..12>-<CODE 10>. Rejects manually-typed
// junk like "LMS-SCHOOL-MNS7LGUAA4879898" (3rd segment must be exactly 10 chars).
const KEY_FORMAT = /^LMS-[A-Z0-9]{2,12}-[A-Z0-9]{10}$/;

const ActivationKeySchema = z.object({
  entityType: z.enum(['School', 'Vendor', 'Individual']),
  schoolId: z.string().optional(),
  vendorId: z.string().optional(),
  parentId: z.string().optional(),
  keys: z.array(z.string().trim().regex(KEY_FORMAT, 'Invalid activation key format.'))
    .min(1, 'Provide at least one key.')
    .max(10000, 'Too many keys requested.'),
  durationDays: z.number({ message: 'Duration must be a number.' }).int('Duration must be a whole number.').min(1, 'Duration must be at least 1 day.').max(36500, 'Duration is too large.'),
  expiresAt: z.string().optional(),
  // Which product this batch of keys is for (src/lib/productIdentity.ts). Defaults to
  // LMS School Android — the existing production behavior — for any caller that omits it.
  productId: z.enum(PRODUCT_ID_ENUM).default(DEFAULT_PRODUCT_ID),
}).refine(data => {
  if (data.entityType === 'School' && !data.schoolId) return false;
  if (data.entityType === 'Vendor' && !data.vendorId) return false;
  if (data.entityType === 'Individual' && !data.parentId) return false;
  return true;
}, { message: 'Select an entity.' });

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

    const insertRows = validData.keys.map(keyVal => ({
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
    }));

    const { data: createdKeys, error } = await supabaseAdmin
      .from('activation_keys')
      .insert(insertRows)
      .select();

    if (error) {
      logger.error({ event: 'CREATE_KEYS_DB_ERROR', code: error.code }, error);
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

    logger.info({ event: 'ACTIVATION_KEYS_CREATED', batchId, keysCount: validData.keys.length, adminEmail: session.email });
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

    logger.info({
      event: 'RESET_DEVICE_BINDING',
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
