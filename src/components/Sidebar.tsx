'use strict';
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { 
  LayoutDashboard, 
  School, 
  PlusCircle, 
  CreditCard, 
  CheckSquare, 
  Key,
  Activity,
  ShieldAlert,
  Shield,
  DownloadCloud,
  Sun,
  Moon,
  LogOut
} from 'lucide-react';

const MENU_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Add School', icon: PlusCircle, path: '/schools/new' },
  { label: 'Add Vendor', icon: PlusCircle, path: '/vendors/new' },
  { label: 'Payments', icon: CreditCard, path: '/payments' },
  { label: 'Keys', icon: Key, path: '/keys' },
  { label: 'Data', icon: School, path: '/data' },
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

  // Use the logout function from AuthContext — no global window access needed
  const handleLogout = () => {
    logout();
  };

  return (
    <aside className="w-52 bg-sidebar-custom sidebar-dashed-border mt-24 flex flex-col h-screen fixed left-0 top-0 z-40 transition-colors duration-300">
      {/* Brand Header */}
      <div className="p-6 pb-2 flex items-center gap-3 mt-[-100px]">
        <img src="/siddesh_logo.png" alt="Siddesh Logo" className="w-10 h-10 object-contain rounded-xl" />
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground transition-colors">
            Siddesh Tech
          </h1>
          <p className="text-[8px] text-zinc-500 font-medium">LMS Track</p>
        </div>
      </div>
      <div className="fading-line"></div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-0.5 overflow-y-auto">
        {MENU_ITEMS.map((item) => {
          const isActive = pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3.5 px-4 py-3 rounded-xl text-xs font-medium group ${
                isActive ? 'sidebar-nav-item-active' : 'sidebar-nav-item'
              }`}
            >
              <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 sidebar-nav-icon`} />
              {item.label} 
            </Link>
          );
        })}
      </nav>

      {/* Theme Toggle, MFA, & Logout Buttons */}
      <div className="px-6 py-4 mb-24 space-y-2">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-full text-xs font-bold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 border border-sidebar-border text-gray-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-all cursor-pointer shadow-sm"
        >
          {isDark ? <Moon className="w-4 h-4 text-white" /> : <Sun className="w-4 h-4 text-amber-500" />}
          {isDark ? 'Dark Theme' : 'Light Theme'}
        </button>


        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-full text-xs font-bold bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 hover:border-rose-500/25 text-rose-400 hover:text-rose-300 transition-all cursor-pointer shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>


    </aside>
  );
}
