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
import { supabaseAdmin } from '@/lib/supabase';
import { deleteWebsiteUser, updateWebsiteProfile, websiteUserIdByEmail } from '@/lib/websiteDb';
import { deleteParentRecords, parseParentEdit, UUID as PARENT_UUID } from '@/lib/parentAccount';

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

// ── Parents: Edit and Delete ─────────────────────────────────────────────────────────────
// A parent can also be an LMS School website account (same email, LMS-Admin only). Edit then
// saves the name and mobile number to the website profile too; Delete removes the website
// account with everything linked to it first, then the parent's panel records.

const PARENT_EDIT_COLUMNS = 'id, parent_id, parent_name, kid_name, email, phone_number, city, state, grade, status';

/** The website account behind a parent, or null. 'unavailable' when LMS-Admin can't reach the website. */
async function parentWebsiteUser(panel: string, email: unknown): Promise<string | null | 'unavailable'> {
  if (panel !== 'lms' || typeof email !== 'string') return null;
  return websiteUserIdByEmail(email);
}

/** One parent, shaped for the Edit pop-up (same fields as the Add form). Null if it can't be loaded. */
export async function getParentForEdit(id: string) {
  const session = await getAdminSession();
  if (!session || typeof id !== 'string' || !PARENT_UUID.test(id)) return null;
  const db = await adminDb();
  const { data: p, error } = await db.from('parents').select(PARENT_EDIT_COLUMNS).eq('id', id).maybeSingle();
  if (error || !p) return null;
  const websiteUser = await parentWebsiteUser(db.panel, p.email);
  return {
    dbId: p.id as string,
    parentId: (p.parent_id as string | null) ?? '',
    /** Signs in to the LMS School website with this email, so the email can't be changed here. */
    websiteLinked: typeof websiteUser === 'string' && websiteUser !== 'unavailable',
    /** The website didn't answer: saving will be refused, so the pop-up says so up front. */
    websiteUnavailable: websiteUser === 'unavailable',
    parentName: (p.parent_name as string | null) ?? '',
    kidName: (p.kid_name as string | null) ?? '',
    email: (p.email as string | null) ?? '',
    phoneNumber: (p.phone_number as string | null) ?? '',
    grade: (p.grade as string | null) ?? '',
    status: (p.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
    city: (p.city as string | null) ?? '',
    state: (p.state as string | null) ?? '',
  };
}

export type ParentEditData = NonNullable<Awaited<ReturnType<typeof getParentForEdit>>>;

export async function updateParentAction(id: string, input: unknown): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || !PARENT_UUID.test(id) || typeof input !== 'object' || input === null) return fail(GENERIC_ERROR);

  try {
    const db = await adminDb();
    const { data: current, error: readError } = await db.from('parents').select('id, email').eq('id', id).maybeSingle();
    if (readError) {
      logger.error({ event: 'UPDATE_PARENT_READ_ERROR', parentDbId: id, code: readError.code });
      return fail(GENERIC_ERROR);
    }
    if (!current) return fail('This parent no longer exists. Refresh the page.');

    const websiteUser = await parentWebsiteUser(db.panel, current.email);
    if (websiteUser === 'unavailable') return fail('The LMS School website could not be reached, so nothing was saved. Please try again.');

    const parsed = parseParentEdit(input, { websiteLinked: !!websiteUser });
    if (!parsed.ok) return fail(parsed.error);
    const v = parsed.data;
    if (websiteUser && v.email !== String(current.email ?? '').trim().toLowerCase()) {
      return fail('This parent signs in to the LMS School website with this email, so it can\'t be changed here.');
    }

    if (websiteUser) {
      const saved = await updateWebsiteProfile(websiteUser, v.parentName, `+91${v.phoneNumber}`);
      if (saved === 'invalid_name') return fail('Enter a valid Parent Name (up to 100 characters).');
      if (saved === 'invalid_phone') return fail('Enter a valid Indian mobile number (starting 6–9).');
      if (saved === 'failed') return fail('The LMS School website could not be updated, so nothing was saved. Please try again.');
      // 'gone': the website account was deleted meanwhile; the panel record is still saved below.
    }

    const { error } = await db.from('parents').update({
      parent_name: sanitize(v.parentName),
      kid_name: sanitize(v.kidName),
      email: sanitize(v.email),
      phone_number: v.phoneNumber,
      grade: sanitize(v.grade),
      status: v.status,
      city: sanitize(v.city),
      state: sanitize(v.state),
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    if (error) {
      logger.error({ event: 'UPDATE_PARENT_DB_ERROR', parentDbId: id, code: error.code });
      if (error.code === '23505') return fail('Another parent already uses this email address.');
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'PARENT_UPDATED', parentDbId: id, websiteUser: !!websiteUser, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists(db.panel); // picker lists (src/lib/entityLists.ts)
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'UPDATE_PARENT_CRITICAL_ERROR', parentDbId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function deleteParentAction(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || !PARENT_UUID.test(id)) return fail(GENERIC_ERROR);

  try {
    const db = await adminDb();
    const { data: parent, error: readError } = await db.from('parents').select('id, email').eq('id', id).maybeSingle();
    if (readError) {
      logger.error({ event: 'DELETE_PARENT_READ_ERROR', parentDbId: id, code: readError.code });
      return fail(GENERIC_ERROR);
    }
    if (!parent) {
      revalidatePath('/[panel]/accounts', 'page');
      return ok(undefined); // already deleted
    }

    // The website account first: if anything below fails, Delete can simply be pressed again.
    const websiteUser = await parentWebsiteUser(db.panel, parent.email);
    if (websiteUser === 'unavailable') return fail('The LMS School website could not be reached, so nothing was deleted. Please try again.');
    let website: 'deleted' | 'gone' | 'none' = 'none';
    if (websiteUser) {
      const removed = await deleteWebsiteUser(websiteUser);
      if (removed === 'staff') return fail('This email is a school staff login on the LMS School website, so it can\'t be deleted here. Nothing was deleted.');
      if (removed === 'failed') return fail('The LMS School website account could not be deleted, so nothing was deleted. Please try again.');
      website = removed;
    }

    const result = await deleteParentRecords(db, id, db.panel === 'lms' ? supabaseAdmin : null);
    if (!result.ok) {
      logger.error({ event: 'DELETE_PARENT_ERROR', parentDbId: id, step: result.step, message: result.message, website });
      return fail(website === 'deleted'
        ? 'The website account was deleted, but some panel records could not be removed. Press Delete again to finish.'
        : 'Some records could not be removed. Press Delete again to finish.');
    }

    logger.info({ event: 'PARENT_DELETED', parentDbId: id, website, ...result.summary, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists(db.panel); // picker lists (src/lib/entityLists.ts)
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
