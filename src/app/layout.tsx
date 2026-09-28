import { Suspense } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { ToastProvider } from '@/components/Toast';
import AuthWrapper from '@/components/AuthWrapper';
import { getAdminSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'LMS Admin Console',
  description: 'Premium enterprise suite for school license provisioning and device tracking.',
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
              <Suspense fallback={<div className="w-40 h-screen bg-surface-hover border-r border-sidebar-border fixed left-0 top-0 rounded-r-[14px]"></div>}>
                <Sidebar panel={session?.panel} />
              </Suspense>
            )}

            {/* Content Wrapper */}
            <div className={`flex-1 ${sessionExists ? 'ml-40' : ''} min-h-screen flex flex-col min-w-0`}>
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
