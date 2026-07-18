'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, fail, ok } from '@/lib/actionResult';

const CreateParentSchema = z.object({
  parentName: z.string().trim().min(1, 'Parent Name is required.').max(150, 'Parent Name is too long.'),
  kidName: z.string().trim().min(1, 'Kid Name is required.').max(150, 'Kid Name is too long.'),
  email: z.string().trim().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a valid Email Address.'),
  phoneNumber: z.string().trim().regex(/^[0-9]{10}$/, 'Mobile Number must be exactly 10 digits.'),
  city: z.string().trim().max(100, 'City is too long.').optional(),
  state: z.string().trim().max(100, 'State is too long.').optional(),
  grade: z.string().trim().max(50, 'Grade is too long.').optional(),
  status: z.enum(['Active', 'Inactive'], { message: 'Status must be Active or Inactive.' }),
});

function generateParentId(): string {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `PAR-${new Date().getFullYear()}-${random}`;
}

export async function createParent(formData: any): Promise<ActionResult<string>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  const parsed = CreateParentSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'CREATE_PARENT_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }
  
  const validData = parsed.data;

  // Clean phone number
  const cleanPhone = validData.phoneNumber.replace(/[\s\-()]/g, '');
  if (!/^[0-9]{10}$/.test(cleanPhone)) {
    return fail('Enter a valid Mobile Number (exactly 10 digits).');
  }

  const parentId = generateParentId();

  // Create structured payload
  const parentPayload = {
    parent_id: parentId,
    parent_name: sanitize(validData.parentName),
    kid_name: sanitize(validData.kidName),
    email: sanitize(validData.email),
    phone_number: sanitize(cleanPhone),
    city: sanitize(validData.city || ''),
    state: sanitize(validData.state || ''),
    grade: sanitize(validData.grade || ''),
    status: validData.status,
  };

  try {
    const { data: newParent, error } = await supabaseAdmin
      .from('parents')
      .insert(parentPayload)
      .select('parent_id')
      .single();

    if (!error) {
      logger.info({ event: 'PARENT_CREATED_DB', parentId: newParent.parent_id, adminEmail: session.email });
      revalidatePath('/data');
      return ok(newParent.parent_id as string);
    }
    
    // Log error and fall back to local file if table not found
    logger.warn({ event: 'CREATE_PARENT_DB_ERROR', code: error.code, message: error.message });
    return fail(`Database error: ${error.message}. Did you run the SQL schema script?`);
  } catch (err) {
    logger.error({ event: 'CREATE_PARENT_DB_CRITICAL' }, err);
    return fail('Failed to register parent profile.');
  }
}
