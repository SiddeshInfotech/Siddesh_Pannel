'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { randomInt } from 'crypto';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

// Activation keys are CREDENTIALS — generate the random portion with a CSPRNG
// (crypto.randomInt is unbiased), never Math.random() which is predictable and
// would let an attacker enumerate valid keys. 10 chars over a 32-symbol
// unambiguous alphabet ≈ 50 bits of entropy.
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateActivationCode(len = 10): string {
  let s = '';
  for (let i = 0; i < len; i++) s += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return s;
}

const PaymentSchema = z.object({
  schoolId: z.string().min(1, 'Select a school.'),
  amount: z.number({ message: 'Amount must be a number.' }).min(0, 'Amount cannot be negative.').max(100000000, 'Amount is too large.').optional(),
  keysCount: z.number({ message: 'Keys count must be a number.' }).int('Keys count must be a whole number.').min(1, 'Generate at least 1 key.').max(10000, 'Keys count is too large.'),
  bankName: z.string().trim().max(120, 'Bank name is too long.').optional(),
  transactionId: z.string().trim().max(120, 'Transaction ID is too long.').optional(),
  paymentDate: z.string().min(1, 'Select a payment date.'),
  status: z.enum(['Unpaid', 'Pending Approval', 'Paid'], { message: 'Select a valid status.' }),
});

export async function createPayment(formData: any): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  const parsed = PaymentSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'CREATE_PAYMENT_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }

  const validData = parsed.data;

  try {
    const generatedTxnId =
      validData.transactionId ||
      'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase();

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        school_id: validData.schoolId,
        amount: validData.amount || 0,
        keys_count: validData.keysCount,
        bank_name: sanitize(validData.bankName || '') || 'Bank Transfer',
        transaction_id: sanitize(generatedTxnId),
        payment_date: new Date(validData.paymentDate).toISOString(),
        status: validData.status,
      })
      .select()
      .single();

    if (paymentError) {
      logger.error({ event: 'CREATE_PAYMENT_DB_ERROR' }, paymentError);
      return fail(GENERIC_ERROR);
    }

    // Fetch school name for key generation
    const { data: school } = await supabaseAdmin
      .from('schools')
      .select('name')
      .eq('id', validData.schoolId)
      .single();

    const sanitizedSchoolName = school
      ? school.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 8)
      : 'SCHOOL';

    // Auto-provision activation keys linked to this payment
    const keyStatus = validData.status === 'Paid' ? 'Paid' : 'Unpaid';
    const keyRows = Array.from({ length: validData.keysCount }, () => {
      return {
        school_id: validData.schoolId,
        payment_id: payment.id,
        key: `LMS-${sanitizedSchoolName}-${generateActivationCode()}`,
        status: keyStatus as 'Unpaid' | 'Paid',
        duration_days: 365,
      };
    });

    if (keyRows.length > 0) {
      await supabaseAdmin.from('activation_keys').insert(keyRows);
    }

    if (keyStatus === 'Paid') {
      await supabaseAdmin
        .from('schools')
        .update({ status: 'Active' })
        .eq('id', validData.schoolId);
    }

    logger.info({ event: 'PAYMENT_CREATED', paymentId: payment.id, adminEmail: session.email });
    revalidatePath('/payments');
    revalidatePath('/keys');
    revalidatePath('/data');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'CREATE_PAYMENT_CRITICAL_ERROR' }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function updatePayment(id: string, formData: any): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  const parsed = PaymentSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'UPDATE_PAYMENT_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }

  const validData = parsed.data;

  try {
    const { error } = await supabaseAdmin
      .from('payments')
      .update({
        school_id: validData.schoolId,
        amount: validData.amount || 0,
        keys_count: validData.keysCount,
        bank_name: sanitize(validData.bankName || '') || 'Bank Transfer',
        transaction_id:
          sanitize(validData.transactionId || '') ||
          'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
        payment_date: new Date(validData.paymentDate).toISOString(),
        status: validData.status,
      })
      .eq('id', id);

    if (error) {
      logger.error({ event: 'UPDATE_PAYMENT_DB_ERROR', paymentId: id }, error);
      return fail(GENERIC_ERROR);
    }

    // Sync linked activation keys' status
    const keyStatus = validData.status === 'Paid' ? 'Paid' : 'Unpaid';
    await supabaseAdmin
      .from('activation_keys')
      .update({ school_id: validData.schoolId, status: keyStatus })
      .eq('payment_id', id);

    if (keyStatus === 'Paid') {
      await supabaseAdmin
        .from('schools')
        .update({ status: 'Active' })
        .eq('id', validData.schoolId);
    }

    logger.info({ event: 'PAYMENT_UPDATED', paymentId: id, adminEmail: session.email });
    revalidatePath('/payments');
    revalidatePath('/keys');
    revalidatePath('/data');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'UPDATE_PAYMENT_CRITICAL_ERROR', paymentId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function deletePayment(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    // Clean up linked activation keys first
    await supabaseAdmin.from('activation_keys').delete().eq('payment_id', id);

    const { error } = await supabaseAdmin.from('payments').delete().eq('id', id);
    if (error) {
      logger.error({ event: 'DELETE_PAYMENT_DB_ERROR', paymentId: id }, error);
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'PAYMENT_DELETED', paymentId: id, adminEmail: session.email });
    revalidatePath('/payments');
    revalidatePath('/keys');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DELETE_PAYMENT_CRITICAL_ERROR', paymentId: id }, err);
    return fail(GENERIC_ERROR);
  }
}

export async function cancelPayment(id: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (typeof id !== 'string' || id.length === 0) return fail(GENERIC_ERROR);

  try {
    await supabaseAdmin.from('payments').update({ status: 'Unpaid' }).eq('id', id);
    await supabaseAdmin
      .from('activation_keys')
      .update({ status: 'Unpaid' })
      .eq('payment_id', id);

    logger.info({ event: 'PAYMENT_CANCELLED', paymentId: id, adminEmail: session.email });
    revalidatePath('/payments');
    revalidatePath('/keys');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'CANCEL_PAYMENT_CRITICAL_ERROR', paymentId: id }, err);
    return fail(GENERIC_ERROR);
  }
}
