import { notFound, redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { PANEL_SLUG, panelFromSlug } from '@/lib/appPanel';

/**
 * Every admin route lives under /lms-admin or /lab-admin. Only those two prefixes exist, and a
 * signed-in admin may only render pages under the prefix of their token's panel. The proxy
 * already redirects mismatches; this is the server-side second lock in case a route is ever
 * reached without it.
 */
export default async function PanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ panel: string }>;
}) {
  const { panel: slug } = await params;
  const urlPanel = panelFromSlug(slug);
  if (!urlPanel) notFound();

  const session = await getAdminSession();
  if (session && session.panel !== urlPanel) {
    redirect(`/${PANEL_SLUG[session.panel]}`);
  }

  return children;
}
