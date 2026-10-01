'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { BASE_PATH } from '@/lib/appPanel';
import {
  LayoutDashboard,
  School,
  CreditCard,
  Key,
  Activity,
  DownloadCloud,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';

type MenuItem = {
  label: string;
  icon: React.ElementType;
  path: string;
};

const MENU_ITEMS: MenuItem[] = [
  { label: 'Overview', icon: LayoutDashboard, path: '/' },
  { label: 'Accounts', icon: School, path: '/accounts' },
  { label: 'Payments', icon: CreditCard, path: '/payments' },
  { label: 'Keys', icon: Key, path: '/keys' },
  { label: 'Monitoring', icon: Activity, path: '/monitoring' },
  { label: 'Update', icon: DownloadCloud, path: '/update' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(true);
  // F-10 fix: get logout from React Context instead of window.__adminLogout
  const { logout } = useAuth();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      const isDarkTheme = savedTheme === 'dark';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDark(isDarkTheme);
      if (isDarkTheme) {
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
      }
    }
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (typeof window !== 'undefined') {
      if (newDark) {
        document.documentElement.classList.remove('light');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.add('light');
        localStorage.setItem('theme', 'light');
      }
    }
  };

  return (
    <aside className="app-sidebar bg-surface-hover border-r border-sidebar-border flex flex-col items-center h-screen fixed left-0 top-0 z-40">
      {/* Brand Logo */}
      <div className="pt-4 pb-3">
        <Image src={`${BASE_PATH}/siddesh_logo.png`} alt="Siddesh Logo" width={36} height={36} className="w-9 h-9 object-contain rounded-lg" />
      </div>

      {/* Navigation Links — icon on top, name below */}
      <nav className="flex-1 w-full px-0.5 py-1 flex flex-col gap-2 overflow-y-auto">
        {MENU_ITEMS.map((item) => {
          const isActive = item.path === '/'
            ? pathname === '/'
            : pathname === item.path || pathname.startsWith(`${item.path}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`sidebar-rail-item flex flex-col items-center gap-0.5 text-[10px] leading-none font-medium ${isActive ? 'sidebar-rail-item-active' : ''}`}
            >
              <span className="sidebar-rail-icon w-8 h-8 rounded-[10px] flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle & Logout */}
      <div className="pb-3 pt-2 flex flex-col items-center gap-1.5">
        <button
          onClick={toggleTheme}
          title={isDark ? 'Light Theme' : 'Dark Theme'}
          aria-label={isDark ? 'Light Theme' : 'Dark Theme'}
          className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-white/5 hover:bg-white/10 border border-sidebar-border transition-all cursor-pointer"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-800" />}
        </button>
        <button
          onClick={logout}
          title="Logout"
          aria-label="Logout"
          className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 hover:border-rose-500/25 text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
