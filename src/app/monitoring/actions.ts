'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { verifyPassword } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';

const ERR_BADPASS = 'Incorrect password.';

export async function deactivateDevice(keyId: string, password: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  if (typeof keyId !== 'string' || keyId.length === 0) return fail(GENERIC_ERROR);

  // Step-up re-authentication: verify the admin's REAL password SERVER-SIDE before a
  // destructive action. No hardcoded secret, no client-side comparison, no hint.
  if (typeof password !== 'string' || password.length === 0) return fail(ERR_BADPASS);

  const { data: admin, error: adminErr } = await supabaseAdmin
    .from('admin_users')
    .select('password_hash, salt')
    .eq('email', session.email)
    .maybeSingle();
  if (adminErr || !admin?.password_hash || !admin?.salt) {
    logger.error({ event: 'DEACTIVATE_REAUTH_LOOKUP_FAILED', email: session.email }, adminErr ?? undefined);
    return fail(GENERIC_ERROR);
  }
  const reauthOk = await verifyPassword(password, admin.password_hash, admin.salt);
  if (!reauthOk) {
    logger.warn({ event: 'DEACTIVATE_REAUTH_FAILED', email: session.email, keyId });
    return fail(ERR_BADPASS);
  }

  try {
    const { error } = await supabaseAdmin
      .from('activation_keys')
      .update({ status: 'Revoked' })
      .eq('id', keyId);

    if (error) {
      logger.error({ event: 'DEACTIVATE_DEVICE_DB_ERROR', keyId }, error);
      return fail(GENERIC_ERROR);
    }

    logger.info({ event: 'DEVICE_DEACTIVATED', keyId, adminEmail: session.email });
    revalidatePath('/monitoring');
    return ok(undefined);
  } catch (err: unknown) {
    logger.error({ event: 'DEACTIVATE_DEVICE_CRITICAL_ERROR', keyId }, err);
    return fail(GENERIC_ERROR);
  }
}
