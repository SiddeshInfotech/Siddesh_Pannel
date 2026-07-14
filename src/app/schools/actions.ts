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
  email: z.string().trim().email('Enter a valid email address.').max(254).optional().or(z.literal('')),
  phone: z.string().trim().max(20, 'Phone number is too long.').optional().or(z.literal('')),
  classroomsCount: z.number({ message: 'Classrooms must be a number.' }).int('Classrooms must be a whole number.').min(0, 'Classrooms cannot be negative.').max(10000, 'Classrooms count is too large.'),
});

export async function deleteSchoolAction(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    const { error } = await supabaseAdmin
      .from('schools')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error({ event: 'DELETE_SCHOOL_ERROR', schoolId: id }, error);
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'SCHOOL_DELETED', schoolId: id, adminEmail: session.email });
    revalidatePath('/schools');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_SCHOOL_CRITICAL_ERROR', schoolId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function updateSchoolAction(id: string, formData: any): Promise<ActionResult> {
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
    if (!/^\+?[0-9]{10,15}$/.test(cleanedPhone)) {
      return fail('Enter a valid phone number (10–15 digits).');
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
    revalidatePath('/schools');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'UPDATE_SCHOOL_CRITICAL_ERROR', schoolId: id }, err);
    return fail(GENERIC_ERROR);
  }
}
