'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

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
    await supabaseAdmin.from('activation_keys').delete().eq('school_id', id);
    await supabaseAdmin.from('payments').delete().eq('school_id', id);

    const { error } = await supabaseAdmin
      .from('schools')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_SCHOOL_ERROR', schoolId: id }, error);
      return fail(error.message || GENERIC_ERROR);
    }

    logger.info({ event: 'SCHOOL_DELETED', schoolId: id, adminEmail: session.email });
    revalidatePath('/data');
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
    await supabaseAdmin.from('activation_keys').delete().eq('vendor_id', id);
    await supabaseAdmin.from('payments').delete().eq('vendor_id', id);

    const { error } = await supabaseAdmin
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

    revalidatePath('/data');

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
    const { error } = await supabaseAdmin
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
    revalidatePath('/data');
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
    const { error } = await supabaseAdmin
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

    revalidatePath('/data');

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
    await supabaseAdmin.from('activation_keys').delete().eq('parent_id', id);
    await supabaseAdmin.from('payments').delete().eq('parent_id', id);

    const { error } = await supabaseAdmin
      .from('parents')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_PARENT_ERROR', parentDbId: id }, error);
      return fail(error.message || GENERIC_ERROR);
    }

    logger.info({ event: 'PARENT_DELETED', parentDbId: id, adminEmail: session.email });
    revalidatePath('/data');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_PARENT_CRITICAL_ERROR', parentDbId: id }, err);
    return fail(GENERIC_ERROR);
  }
}