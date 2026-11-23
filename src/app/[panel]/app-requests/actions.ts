'use server';

import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { logger } from '@/lib/logger';
import { markWebsiteAppSent, WEBSITE_UUID } from '@/lib/websiteDb';

// "Mark sent": the team has sent this website buyer the Windows app (.exe).
// LMS-Admin only; the website records who marked it and when.
export async function markAppRequestSentAction(userId: string): Promise<ActionResult<{ already: boolean }>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (session.panel !== 'lms') return fail('App requests are handled in LMS-Admin.');
  if (typeof userId !== 'string' || !WEBSITE_UUID.test(userId)) return fail(GENERIC_ERROR);

  const result = await markWebsiteAppSent(userId, session.email);
  if (result === 'failed') return fail(GENERIC_ERROR);
  logger.info({ event: 'APP_REQUEST_MARKED_SENT', already: result === 'already' });
  revalidatePath('/[panel]/app-requests', 'page');
  return ok({ already: result === 'already' });
}
