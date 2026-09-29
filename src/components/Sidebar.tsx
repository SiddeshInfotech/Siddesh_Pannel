'use strict';
'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { APP_PANEL, BASE_PATH } from '@/lib/appPanel';
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
  ChevronDown,
  ChevronRight
} from 'lucide-react';

type SubItem = {
  label: string;
  path: string;
};

type MenuItem = {
  label: string;
  icon: React.ElementType;
  path?: string;
  subItems?: SubItem[];
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
};

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
      { label: 'Accounts', icon: School, path: '/accounts' },
    ]
  },
  {
    title: 'Management',
    items: [
      { label: 'Payments', icon: CreditCard, path: '/payments' },
      { label: 'Keys', icon: Key, path: '/keys' },
    ]
  },
  {
    title: 'System',
    items: [
      { label: 'Monitoring', icon: Activity, path: '/monitoring' },
      { label: 'Update', icon: DownloadCloud, path: '/update' },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get('tab');
  const [isDark, setIsDark] = useState(true);
  const [openDropdowns, setOpenDropdowns] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<string[]>([MENU_GROUPS[0].title]);
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

  // Use the logout function from AuthContext — no global window access needed
  const handleLogout = () => {
    logout();
  };

  const toggleDropdown = (label: string) => {
    setOpenDropdowns((prev) => 
      prev.includes(label) 
        ? prev.filter(item => item !== label)
        : [...prev, label]
    );
  };

  const toggleGroup = (title: string) => {
    setOpenGroups((prev) => 
      prev.includes(title) 
        ? []
        : [title]
    );
  };

  return (
    <aside className="w-40 bg-surface-hover border-r border-sidebar-border flex flex-col h-screen fixed left-0 top-0 z-40 rounded-r-[14px]">
      {/* Brand Header */}
      <div className="px-4 pt-6 pb-2 flex items-center gap-2">
        <Image src={`${BASE_PATH}/siddesh_logo.png`} alt="Siddesh Logo" width={32} height={32} className="w-8 h-8 object-contain rounded-lg" />
        <div className="min-w-0">
          <h1 className="text-[13px] font-bold tracking-tight text-foreground transition-colors leading-tight truncate">
            Siddesh Tech
          </h1>
          <p className="text-[8px] text-zinc-500 font-medium mt-0.5">{APP_PANEL === 'lab' ? 'Lab Admin' : 'LMS Track'}</p>
        </div>
      </div>
      <div className="fading-line"></div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-6 space-y-4 overflow-y-auto">
        {MENU_GROUPS.map((group) => {
          const isGroupOpen = openGroups.includes(group.title);
          return (
          <div key={group.title} className="space-y-1 mb-2">
            <button
              onClick={() => toggleGroup(group.title)}
              className="w-full flex items-center justify-between px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1 hover:text-foreground transition-colors cursor-pointer"
            >
              <span>{group.title}</span>
              {isGroupOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            <div 
              className={`grid transition-all duration-300 ease-in-out ${
                isGroupOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.path 
                    ? pathname === item.path 
                    : item.subItems?.some(sub => {
                        if (sub.path.includes('?tab=')) {
                          return pathname === sub.path.split('?')[0] && currentTab === sub.path.split('?tab=')[1];
                        }
                        return pathname === sub.path;
                      });
                  const Icon = item.icon;
                  const isDropdownOpen = openDropdowns.includes(item.label);

                  if (item.subItems) {
                    return (
                      <div key={item.label} className="space-y-1">
                        <button
                          onClick={() => toggleDropdown(item.label)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[12px] font-medium group ${
                            isActive ? 'sidebar-nav-item-active' : 'sidebar-nav-item'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 sidebar-nav-icon`} />
                            {item.label}
                          </div>
                          {isDropdownOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {/* Dropdown Content */}
                        <div 
                          className={`grid transition-all duration-300 ease-in-out ${
                            isDropdownOpen ? 'grid-rows-[1fr] opacity-100 mt-1' : 'grid-rows-[0fr] opacity-0'
                          }`}
                        >
                          <div className="overflow-hidden flex flex-col gap-1 pl-10 pr-2 sidebar-tree">
                            {item.subItems.map(subItem => {
                              const isSubActive = subItem.path.includes('?tab=')
                                ? pathname === subItem.path.split('?')[0] && currentTab === subItem.path.split('?tab=')[1]
                                : pathname === subItem.path;
                              return (
                                <Link
                                  key={subItem.path}
                                  href={subItem.path}
                                  className={`flex items-center py-2 px-3 rounded-lg text-[11px] font-medium transition-colors sidebar-tree-item ${
                                    isSubActive 
                                      ? 'bg-white/5 text-foreground' 
                                      : 'text-zinc-500 hover:text-foreground hover:bg-white/5'
                                  }`}
                                >
                                  {subItem.label}
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.path}
                      href={item.path!}
                      className={`flex items-center gap-2.5 px-3 py-2 mr-2 rounded-xl text-[11px] font-medium group ${
                        isActive ? 'sidebar-nav-item-active' : 'sidebar-nav-item'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110 sidebar-nav-icon`} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )})}
      </nav>

      {/* Theme Toggle, MFA, & Logout Buttons */}
      <div className="px-3 pb-3 pt-4 space-y-2">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-sidebar-border text-zinc-400 hover:text-white transition-all cursor-pointer"
        >
          {isDark ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-slate-800" />}
          <span className="whitespace-nowrap">{isDark ? 'Light Theme' : 'Dark Theme'}</span>
        </button>


        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-[11px] font-bold bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 hover:border-rose-500/25 text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Logout</span>
        </button>
      </div>


    </aside>
  );
}
