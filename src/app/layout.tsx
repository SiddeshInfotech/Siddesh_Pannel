import { Suspense } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { ToastProvider } from '@/components/Toast';
import AuthWrapper from '@/components/AuthWrapper';
import { getAdminSession } from '@/lib/auth';
import { APP_PANEL } from '@/lib/appPanel';

export const metadata: Metadata = {
  title: `Siddesh Tech — ${APP_PANEL === 'lab' ? 'Lab' : 'LMS'} Admin Console`,
  description:
    'One calm, secure command centre for every school, vendor and parent we serve — issue licence keys, track payments, watch every device live and verify each cryptographic handshake, all in a clean interface built to feel effortless in light or dark.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAdminSession();
  const sessionExists = !!session;

  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex bg-background">
        <ToastProvider>
          <AuthWrapper sessionExists={sessionExists}>
            {/* Sidebar Nav */}
            {sessionExists && (
              <Suspense fallback={<div className="app-sidebar h-screen bg-surface-hover border-r border-sidebar-border fixed left-0 top-0"></div>}>
                <Sidebar />
              </Suspense>
            )}

            {/* Content Wrapper */}
            <div className={`flex-1 ${sessionExists ? 'app-content' : ''} min-h-screen flex flex-col min-w-0`}>
              {/* Main Workspace */}
              <main className="flex-1 pt-8 pb-8 pl-4 pr-4 overflow-y-auto">
                {sessionExists ? children : <div className="min-h-screen w-full bg-[#09090b]" />}
              </main>
            </div>
          </AuthWrapper>
        </ToastProvider>
      </body>
    </html>
  );
}
