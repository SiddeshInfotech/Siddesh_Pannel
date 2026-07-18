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
            {sessionExists && <Sidebar />}

            {/* Content Wrapper */}
            <div className={`flex-1 ${sessionExists ? 'ml-52' : ''} min-h-screen flex flex-col min-w-0`}>
              {/* Main Workspace */}
              <main className="flex-1 p-8 overflow-y-auto">
                {sessionExists ? children : <div className="min-h-screen w-full bg-[#09090b]" />}
              </main>
            </div>
          </AuthWrapper>
        </ToastProvider>
      </body>
    </html>
  );
}
