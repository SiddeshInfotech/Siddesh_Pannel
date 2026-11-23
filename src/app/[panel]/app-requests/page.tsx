import { notFound } from 'next/navigation';
import { MonitorDown } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
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

  const requests = await websiteAppRequests();
  const open = requests?.filter((r) => r.status === 'pending').length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="App requests"
        icon={MonitorDown}
        description={requests === null
          ? 'Website requests for the Windows app'
          : open === 0 ? 'No requests waiting. Buyers are told they get the app within 24 hours.' : `${open} waiting. Send each buyer the Windows app (.exe) on WhatsApp within 24 hours, then mark it sent.`}
      />
      <AppRequestsClient requests={requests} />
    </div>
  );
}
