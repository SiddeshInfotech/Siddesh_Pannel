'use server';

import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { adminDb } from '@/lib/panelTables';
import { invalidateEntityLists } from '@/lib/entityLists';
import { chunk, fetchAllPages, humanDuration } from '../update/telemetry';

const UpdateSchoolSchema = z.object({
  name: z.string().trim().min(1, 'School name is required.').max(120, 'School name is too long.'),
  board: z.enum(['CBSE', 'State Board', 'ICSE', 'IB', 'IGCSE'], { message: 'Select a valid board.' }),
  mediums: z.array(z.string()).min(1, 'Select at least one medium.'),
  street: z.string().trim().min(1, 'Street is required.').max(200, 'Street is too long.'),
  city: z.string().trim().min(1, 'City is required.').max(80, 'City is too long.'),
  state: z.string().trim().min(1, 'State is required.').max(80, 'State is too long.'),
  zipCode: z.string().trim().regex(/^[0-9]{4,10}$/, 'Enter a valid ZIP / PIN code.'),
  coordinatorName: z.string().trim().max(120, 'Coordinator name is too long.').optional(),
  email: z.string().trim().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a valid email address.').optional().or(z.literal('')),
  phone: z.string().trim().regex(/^[0-9]{10}$/, 'Phone number must be exactly 10 digits.').optional().or(z.literal('')),
  classroomsCount: z.number({ message: 'Classrooms must be a number.' }).int('Classrooms must be a whole number.').min(0, 'Classrooms cannot be negative.').max(10000, 'Classrooms count is too large.'),
});

const UpdateVendorSchema = z.object({
  vendorName: z.string().trim().min(1, 'Vendor Name is required.').max(150),
  vendorType: z.string().trim().min(1, 'Vendor Type is required.'),
  businessCategory: z.string().trim().min(1, 'Business Category is required.'),
  status: z.enum(['Active', 'Inactive']),

  description: z.string().trim().max(500).optional(),

  contactPersonName: z.string().trim().min(1, 'Contact Person Name is required.'),
  designation: z.string().trim().optional(),

  mobileNumber: z.string().trim().regex(/^[0-9]{10}$/, 'Mobile Number must be exactly 10 digits.'),
  alternateMobile: z.string().trim().regex(/^[0-9]{10}$/, 'Alternate Mobile must be exactly 10 digits.').optional().or(z.literal('')),

  emailAddress: z.string().trim().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a valid Email Address.'),
  website: z.string().trim().regex(/^(https?:\/\/)?([\w\d\-]+\.)+\w{2,}(\/.*)?$/, 'Enter a valid Website URL.').optional().or(z.literal('')),

  addressLine1: z.string().trim().min(1, 'Address Line 1 is required.'),
  addressLine2: z.string().trim().optional(),

  city: z.string().trim().min(1),
  district: z.string().trim().optional(),

  state: z.string().trim().min(1),
  country: z.string().trim().min(1),

  pincode: z.string().trim(),

  gstNumber: z.string().trim().optional(),
  panNumber: z.string().trim().optional(),
  businessRegistrationNumber: z.string().trim().optional(),
  msmeRegistration: z.string().trim().optional(),

  gstCertificateName: z.string().optional(),
  panCardName: z.string().optional(),
});

export async function deleteSchoolAction(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    // Manually cascade delete dependent records
    await (await adminDb()).from('activation_keys').delete().eq('school_id', id);
    await (await adminDb()).from('payments').delete().eq('school_id', id);

    const { error } = await (await adminDb())
      .from('schools')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_SCHOOL_ERROR', schoolId: id }, error);
      return fail(error.message || GENERIC_ERROR);
    }

    logger.info({ event: 'SCHOOL_DELETED', schoolId: id, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_SCHOOL_CRITICAL_ERROR', schoolId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function deleteVendorAction(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    // Manually cascade delete dependent records
    await (await adminDb()).from('activation_keys').delete().eq('vendor_id', id);
    await (await adminDb()).from('payments').delete().eq('vendor_id', id);

    const { error } = await (await adminDb())
      .from('vendors')
      .delete()
      .eq('vendor_id', id);

    if (error) {
      logger.error({ event: 'DELETE_VENDOR_ERROR', vendorId: id }, error);
      return fail(error.message || GENERIC_ERROR);
    }

    logger.info({
      event: 'VENDOR_DELETED',
      vendorId: id,
      adminEmail: session.email,
    });

    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)

    return ok(undefined);
  } catch (err: unknown) {
    logger.error(
      { event: 'DELETE_VENDOR_CRITICAL_ERROR', vendorId: id },
      err
    );

    return fail(GENERIC_ERROR);
  }
}

export async function updateSchoolAction(id: string, formData: any /* eslint-disable-line @typescript-eslint/no-explicit-any */): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  const parsed = UpdateSchoolSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'UPDATE_SCHOOL_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }
  const validData = parsed.data;

  if (validData.phone) {
    const cleanedPhone = validData.phone.replace(/[\s\-()]/g, '');
    if (!/^[0-9]{10}$/.test(cleanedPhone)) {
      return fail('Enter a valid phone number (exactly 10 digits).');
    }
  }

  try {
    const { error } = await (await adminDb())
      .from('schools')
      .update({
        name: sanitize(validData.name),
        board: validData.board,
        mediums: validData.mediums,
        street: sanitize(validData.street),
        city: sanitize(validData.city),
        state: sanitize(validData.state),
        zip_code: sanitize(validData.zipCode),
        country: 'India',
        coordinator_name: sanitize(validData.coordinatorName || ''),
        email: sanitize(validData.email || ''),
        phone: sanitize(validData.phone || ''),
        classrooms_count: validData.classroomsCount,
      })
      .eq('id', id);

    if (error) {
      logger.error({ event: 'UPDATE_SCHOOL_DB_ERROR', schoolId: id, code: error.code }, error);
      if (error.code === '23505') {
        if (error.message.includes('email')) return fail('This email is already registered.');
        return fail('A duplicate value was detected. Please use unique values.');
      }
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'SCHOOL_UPDATED', schoolId: id, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'UPDATE_SCHOOL_CRITICAL_ERROR', schoolId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function updateVendorAction(
  id: string,
  formData: any /* eslint-disable-line @typescript-eslint/no-explicit-any */
): Promise<ActionResult> {
  const session = await getAdminSession();

  if (!session)
    return fail('Unauthorized. Please sign in again.');

  if (!id)
    return fail(GENERIC_ERROR);

  const parsed = UpdateVendorSchema.safeParse(formData);

  if (!parsed.success) {
    logger.warn({
      event: 'UPDATE_VENDOR_VALIDATION_FAILED',
      errors: parsed.error.flatten(),
    });

    return fail(
      parsed.error.issues[0]?.message ??
        'Please check the form and try again.'
    );
  }

  const validData = parsed.data;

  const cleanPhone = validData.mobileNumber.replace(
    /[\s\-()]/g,
    ''
  );

  if (!/^[0-9]{10}$/.test(cleanPhone)) {
    return fail('Enter a valid Mobile Number (exactly 10 digits).');
  }

  try {
    const { error } = await (await adminDb())
      .from('vendors')
      .update({
        vendor_name: sanitize(validData.vendorName),
        vendor_type: sanitize(validData.vendorType),
        business_category: sanitize(validData.businessCategory),
        status: validData.status,
        description: sanitize(validData.description || ''),

        contact_person_name: sanitize(validData.contactPersonName),
        designation: sanitize(validData.designation || ''),
        mobile_number: sanitize(cleanPhone),
        alternate_mobile: sanitize(validData.alternateMobile || ''),
        email_address: sanitize(validData.emailAddress),
        website: sanitize(validData.website || ''),

        address_line_1: sanitize(validData.addressLine1),
        address_line_2: sanitize(validData.addressLine2 || ''),
        city: sanitize(validData.city),
        district: sanitize(validData.district || ''),
        state: sanitize(validData.state),
        country: sanitize(validData.country),
        pincode: sanitize(validData.pincode),

        gst_number: sanitize(validData.gstNumber || ''),
        pan_number: sanitize(validData.panNumber || ''),
        business_registration_number: sanitize(
          validData.businessRegistrationNumber || ''
        ),
        msme_registration: sanitize(
          validData.msmeRegistration || ''
        ),

        gst_certificate_name: sanitize(
          validData.gstCertificateName || ''
        ),
        pan_card_name: sanitize(
          validData.panCardName || ''
        ),

        updated_at: new Date().toISOString(),
      })
      .eq('vendor_id', id);

    if (error) {
      logger.error(
        {
          event: 'UPDATE_VENDOR_DB_ERROR',
          vendorId: id,
          code: error.code,
        },
        error
      );

      return fail(GENERIC_ERROR);
    }

    logger.info({
      event: 'VENDOR_UPDATED',
      vendorId: id,
      adminEmail: session.email,
    });

    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)

    return ok(undefined);
  } catch (err) {
    logger.error(
      {
        event: 'UPDATE_VENDOR_CRITICAL_ERROR',
        vendorId: id,
      },
      err
    );

    return fail(GENERIC_ERROR);
  }
}

export async function deleteParentAction(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    // Manually cascade delete dependent records
    await (await adminDb()).from('activation_keys').delete().eq('parent_id', id);
    await (await adminDb()).from('payments').delete().eq('parent_id', id);

    const { error } = await (await adminDb())
      .from('parents')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_PARENT_ERROR', parentDbId: id }, error);
      return fail(error.message || GENERIC_ERROR);
    }

    logger.info({ event: 'PARENT_DELETED', parentDbId: id, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_PARENT_CRITICAL_ERROR', parentDbId: id }, err);
    return fail(GENERIC_ERROR);
  }
}
/** One vendor, shaped for the Edit Vendor pop-up (same fields as the Add form). */
export async function getVendorForEdit(id: string) {
  const session = await getAdminSession();
  if (!session || !id) return null;
  const { data: v, error } = await (await adminDb()).from('vendors').select('*').eq('vendor_id', id).single();
  if (error || !v) return null;
  return {
    dbId: v.vendor_id as string,
    vendorName: v.vendor_name || '',
    vendorType: v.vendor_type || '',
    businessCategory: v.business_category || '',
    status: (v.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
    description: v.description || '',
    contactPersonName: v.contact_person_name || '',
    designation: v.designation || '',
    mobileNumber: v.mobile_number || '',
    alternateMobile: v.alternate_mobile || '',
    emailAddress: v.email_address || '',
    website: v.website || '',
    addressLine1: v.address_line_1 || '',
    addressLine2: v.address_line_2 || '',
    city: v.city || '',
    district: v.district || '',
    state: v.state || '',
    country: v.country || '',
    pincode: v.pincode || '',
    gstNumber: v.gst_number || '',
    panNumber: v.pan_number || '',
    businessRegistrationNumber: v.business_registration_number || '',
    msmeRegistration: v.msme_registration || '',
    gstCertificateName: v.gst_certificate_name || '',
    panCardName: v.pan_card_name || '',
  };
}

export type VendorEditData = NonNullable<Awaited<ReturnType<typeof getVendorForEdit>>>;

// ── Licence keys of one account (Accounts page → key-count pop-up) ───────────────────────
export type AccountKind = 'vendor' | 'school' | 'parent';
export type AccountKeyStatus = 'active' | 'superseded' | 'expired' | 'failed' | 'revoked' | 'not_activated';
export interface AccountKeyRow {
  id: string;
  key: string;
  createdAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  timeLeft: string;
  status: AccountKeyStatus;
}

const OWNER_COLUMN: Record<AccountKind, 'vendor_id' | 'school_id' | 'parent_id'> = {
  vendor: 'vendor_id',
  school: 'school_id',
  parent: 'parent_id',
};

function timeLeft(expiresAt: string | null, activatedAt: string | null, durationDays: number | null, now: number): string {
  if (expiresAt) {
    const ms = new Date(expiresAt).getTime() - now;
    return ms <= 0 ? 'Expired' : `${humanDuration(ms / 1000)} left`;
  }
  if (!activatedAt && durationDays) return `${durationDays}d from activation`;
  return 'No expiry';
}

/**
 * Every licence key owned by one vendor / school / parent, with its lifecycle status:
 *   revoked → deactivated by an admin
 *   expired → past expires_at
 *   failed  → never activated, and at least one activation attempt with it FAILED
 *   not_activated → never activated (no failed attempts either)
 *   superseded → was activated, but a newer key has since been activated on the same device
 *   active  → activated and still the key that device runs
 * `id` is the owner reference used on activation_keys: vendors.vendor_id, schools.id, parents.id.
 */
export async function getAccountKeys(kind: AccountKind, id: string): Promise<ActionResult<AccountKeyRow[]>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (!(kind in OWNER_COLUMN) || typeof id !== 'string' || id.length === 0 || id.length > 100) return fail(GENERIC_ERROR);

  try {
    const db = await adminDb();
    const { data: keys, error } = await fetchAllPages<any /* eslint-disable-line @typescript-eslint/no-explicit-any */>((from, to) =>
      db.from('activation_keys')
        .select('id, key, status, created_at, activated_at, expires_at, duration_days, device_fingerprint')
        .eq(OWNER_COLUMN[kind], id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to));
    if (error) {
      logger.error({ event: 'ACCOUNT_KEYS_LOAD_ERROR', kind, message: error.message });
      return fail(GENERIC_ERROR);
    }

    // Successor activations on the same devices (any owner) and each device's live key.
    const fingerprints = [...new Set(keys.map((k) => k.device_fingerprint).filter(Boolean))] as string[];
    const activationsByFp = new Map<string, { id: string; at: number }[]>();
    const liveKeyByFp = new Map<string, string>();
    for (const part of chunk(fingerprints)) {
      const [{ data: onDevice }, { data: status }] = await Promise.all([
        db.from('activation_keys').select('id, activated_at, device_fingerprint').in('device_fingerprint', part).not('activated_at', 'is', null),
        db.from('device_status').select('device_fingerprint, activation_key').in('device_fingerprint', part),
      ]);
      for (const k of onDevice ?? []) {
        const list = activationsByFp.get(k.device_fingerprint) ?? [];
        list.push({ id: k.id, at: new Date(k.activated_at).getTime() });
        activationsByFp.set(k.device_fingerprint, list);
      }
      for (const s of status ?? []) if (s.activation_key) liveKeyByFp.set(s.device_fingerprint, s.activation_key);
    }

    // Failed activation attempts for keys that never got bound.
    const unbound = keys.filter((k) => !k.device_fingerprint).map((k) => k.key).filter(Boolean) as string[];
    const failedKeys = new Set<string>();
    for (const part of chunk(unbound)) {
      const { data: logs } = await db.from('handshake_logs').select('activation_key').in('activation_key', part).eq('status', 'FAILED');
      for (const l of logs ?? []) failedKeys.add(l.activation_key);
    }

    const now = Date.now();
    const rows: AccountKeyRow[] = keys.map((k) => {
      const fp: string | null = k.device_fingerprint || null;
      const expired = !!k.expires_at && new Date(k.expires_at).getTime() <= now;
      let status: AccountKeyStatus;
      if (k.status === 'Revoked') status = 'revoked';
      else if (expired) status = 'expired';
      else if (!fp) status = failedKeys.has(k.key) ? 'failed' : 'not_activated';
      else {
        const live = liveKeyByFp.get(fp);
        const at = k.activated_at ? new Date(k.activated_at).getTime() : 0;
        const newer = (activationsByFp.get(fp) ?? []).some((o) => o.id !== k.id && o.at > at);
        status = (live ? live !== k.key : newer) ? 'superseded' : 'active';
      }
      return {
        id: k.id,
        key: k.key ?? '—',
        createdAt: k.created_at ?? null,
        activatedAt: k.activated_at ?? null,
        expiresAt: k.expires_at ?? null,
        timeLeft: status === 'revoked' ? '—' : timeLeft(k.expires_at ?? null, k.activated_at ?? null, k.duration_days ?? null, now),
        status,
      };
    });
    return ok(rows);
  } catch (err: unknown) {
    logger.error({ event: 'ACCOUNT_KEYS_CRITICAL_ERROR', kind }, err);
    return fail(GENERIC_ERROR);
  }
}
