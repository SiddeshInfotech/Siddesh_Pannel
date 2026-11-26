import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { websiteAppRequests } from '@/lib/websiteDb';
import AppRequestsClient from './AppRequestsClient';

export const dynamic = 'force-dynamic';

// Website buyers who asked for the Windows app (.exe). The team sends it within 24 hours,
// then marks the request sent here. LMS-Admin only: the requests live in the website's database.
export default async function AppRequestsPage() {
  const session = await getAdminSession();
  if (!session) return null;
  if (session.panel !== 'lms') notFound();

  return <AppRequestsClient requests={await websiteAppRequests()} />;
}
