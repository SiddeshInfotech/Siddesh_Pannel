'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

// Per-field validation with safe, human messages. The FIRST failing message is
// returned to the UI — specific enough to be useful, never leaking internals.
const CreateSchoolSchema = z.object({
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
  academicYear: z.string().trim().max(20).optional(),
  section: z.string().trim().max(40).optional(),
  standard: z.string().trim().max(40).optional(),
  fullClassName: z.string().trim().max(80).optional(),
});

// Auto-generate schoolId matching the original Mongoose pre-save hook logic
function generateSchoolId(board: string, city: string): string {
  const random = Math.floor(100 + Math.random() * 900);
  const boardCode = board.replace(/\s+/g, '').toUpperCase().substring(0, 4);
  const cityCode = city.toUpperCase().substring(0, 3);
  return `SCH-${new Date().getFullYear()}-${boardCode}-${cityCode}-${random}`;
}

export async function createSchool(formData: any /* eslint-disable-line @typescript-eslint/no-explicit-any */): Promise<ActionResult<string>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  const parsed = CreateSchoolSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'CREATE_SCHOOL_VALIDATION_FAILED', errors: parsed.error.flatten() });
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
    const { data: newSchool, error } = await supabaseAdmin.from('schools').insert({
      school_id: generateSchoolId(validData.board, validData.city),
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
      has_computer_lab: false,
      internet_access: 'BASIC',
      academic_year: sanitize(validData.academicYear || ''),
      section: sanitize(validData.section || ''),
      standard: sanitize(validData.standard || ''),
      full_class_name: sanitize(validData.fullClassName || ''),
      status: 'Draft',
    }).select('id').single();

    if (error) {
      logger.error({ event: 'CREATE_SCHOOL_DB_ERROR', code: error.code }, error);
      if (error.code === '23505') {
        if (error.message.includes('school_id')) return fail('This School ID is already registered.');
        if (error.message.includes('email')) return fail('This email is already registered.');
        return fail('A duplicate value was detected. Please use unique values.');
      }
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'SCHOOL_CREATED', schoolId: newSchool.id, adminEmail: session.email });
    revalidatePath('/data');
    return ok(newSchool.id as string);
  } catch (err: unknown) {
    logger.error({ event: 'CREATE_SCHOOL_CRITICAL_ERROR' }, err);
    return fail(GENERIC_ERROR);
  }
}
