'use server';

import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { ActionResult, GENERIC_ERROR, fail, ok } from '@/lib/actionResult';
import { logger } from '@/lib/logger';
import { cleanLeadEdit, isLeadStage, type LeadEdit, type LeadEvent } from '@/lib/leads';
import { deleteWebsiteLead, setWebsiteLeadStage, updateWebsiteLead, websiteLeadTimeline, WEBSITE_UUID } from '@/lib/websiteDb';

// Moves a website contact enquiry to another stage. LMS-Admin only; the website records who and when.
export async function setLeadStageAction(id: string, stage: string): Promise<ActionResult> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');
  if (session.panel !== 'lms') return fail('Leads are handled in LMS-Admin.');
  if (typeof id !== 'string' || !WEBSITE_UUID.test(id) || !isLeadStage(stage)) return fail(GENERIC_ERROR);

  if (!(await setWebsiteLeadStage(id, stage, session.email))) return fail(GENERIC_ERROR);
  logger.info({ event: 'LEAD_STAGE_SET', stage });
  revalidatePath('/[panel]/leads', 'page');
  return ok(undefined);
}

// The signed-in LMS-Admin's email, or the message to show instead.
const guard = async (): Promise<{ email: string } | { denied: string }> => {
  const session = await getAdminSession();
  if (!session) return { denied: 'Unauthorized. Please sign in again.' };
  if (session.panel !== 'lms') return { denied: 'Leads are handled in LMS-Admin.' };
  return { email: session.email };
};

// Corrects a lead's details. Every field is checked again here, whatever the form allowed.
export async function updateLeadAction(id: string, input: Partial<Record<keyof LeadEdit, unknown>>): Promise<ActionResult<{ errors?: Partial<Record<keyof LeadEdit, string>> }>> {
  const g = await guard();
  if ('denied' in g) return fail(g.denied);
  if (typeof id !== 'string' || !WEBSITE_UUID.test(id) || typeof input !== 'object' || input === null) return fail(GENERIC_ERROR);
  const clean = cleanLeadEdit(input);
  if (!clean.ok) return ok({ errors: clean.errors });
  if (!(await updateWebsiteLead(id, clean.value, g.email))) return fail(GENERIC_ERROR);
  logger.info({ event: 'LEAD_EDITED' });
  revalidatePath('/[panel]/leads', 'page');
  return ok({});
}

export async function deleteLeadAction(id: string): Promise<ActionResult> {
  const g = await guard();
  if ('denied' in g) return fail(g.denied);
  if (typeof id !== 'string' || !WEBSITE_UUID.test(id)) return fail(GENERIC_ERROR);
  if (!(await deleteWebsiteLead(id))) return fail('This lead could not be deleted. It may already be gone.');
  logger.info({ event: 'LEAD_DELETED' });
  revalidatePath('/[panel]/leads', 'page');
  return ok(undefined);
}

export async function leadTimelineAction(id: string): Promise<ActionResult<LeadEvent[]>> {
  const g = await guard();
  if ('denied' in g) return fail(g.denied);
  if (typeof id !== 'string' || !WEBSITE_UUID.test(id)) return fail(GENERIC_ERROR);
  const events = await websiteLeadTimeline(id);
  return events ? ok(events) : fail(GENERIC_ERROR);
}
