import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { isLeadStage, LEADS_PAGE_SIZE } from '@/lib/leads';
import { websiteLeads } from '@/lib/websiteDb';
import LeadsClient from './LeadsClient';

export const dynamic = 'force-dynamic';

// Contact-form enquiries from the LMS School website, as sales leads with a stage.
// LMS-Admin only: the enquiries live in the website's database.
export default async function LeadsPage(props: { searchParams: Promise<{ stage?: string; page?: string }> }) {
  const session = await getAdminSession();
  if (!session) return null;
  if (session.panel !== 'lms') notFound();

  const params = await props.searchParams;
  const stage = isLeadStage(params.stage) ? params.stage : null;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1), 10_000);
  const data = await websiteLeads(stage, page);

  return <LeadsClient data={data} stage={stage} page={page} pages={data ? Math.max(Math.ceil(data.total / LEADS_PAGE_SIZE), 1) : 1} />;
}
