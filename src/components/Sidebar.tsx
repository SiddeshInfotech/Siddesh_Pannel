'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import siddeshLogo from './siddesh-logo-72.png';
import Link from '@/components/PanelLink';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { usePanelPath, usePanelSlug } from '@/lib/usePanelPath';
import {
  LayoutDashboard,
  School,
  CreditCard,
  Key,
  Activity,
  DownloadCloud,
  ScrollText,
  HeartPulse,
  Sun,
  Moon,
  LogOut,
  MonitorDown,
  Contact,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from 'lucide-react';

type MenuItem = {
  label: string;
  icon: React.ElementType;
  path: string;
  /** Shown only in LMS-Admin (data that lives on the LMS School website). */
  lmsOnly?: boolean;
};

// Grouped by job; a group with nothing to show in this panel is left out.
const MENU_GROUPS: { title: string; items: MenuItem[] }[] = [
  { title: 'Home', items: [{ label: 'Overview', icon: LayoutDashboard, path: '/' }] },
  {
    title: 'Customers',
    items: [
      { label: 'Accounts', icon: School, path: '/accounts' },
      { label: 'Keys', icon: Key, path: '/keys' },
      { label: 'Payments', icon: CreditCard, path: '/payments' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { label: 'Leads', icon: Contact, path: '/leads', lmsOnly: true },
      { label: 'Requests', icon: MonitorDown, path: '/app-requests', lmsOnly: true },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Monitoring', icon: Activity, path: '/monitoring' },
      { label: 'Health', icon: HeartPulse, path: '/health' },
      { label: 'Update', icon: DownloadCloud, path: '/update' },
      { label: 'Logs', icon: ScrollText, path: '/logs' },
    ],
  },
];

export default function Sidebar() {
  const panelSlug = usePanelSlug();
  // In-panel path: '/lab-admin/keys' → '/keys' (menu paths are panel-relative).
  const pathname = usePathname().slice(panelSlug.length + 1) || '/';
  const [isDark, setIsDark] = useState(true);
  // Wide view (the default): category tree with names. The narrow rail is remembered on this browser.
  const [wide, setWide] = useState(true);
  // Open categories in the wide view: all open on every page load; several can be open at once.
  const [openGroups, setOpenGroups] = useState<string[]>(() => MENU_GROUPS.map((g) => g.title));
  // F-10 fix: get logout from React Context instead of window.__adminLogout
  const { logout } = useAuth();
  // Hover/focus on a menu item starts loading that page's data, so the click usually lands on a
  // ready page. Same authenticated GET as the click itself (proxy-checked); pages only read on render.
  const router = useRouter();
  const toPanel = usePanelPath();
  const prefetchFull = (path: string) => router.prefetch(toPanel(path), { kind: 'full' } as Parameters<typeof router.prefetch>[1]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedWide = localStorage.getItem('sidebar') !== 'narrow';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWide(savedWide);
      document.documentElement.classList.toggle('sidebar-narrow', !savedWide);
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

  const toggleWide = () => {
    const next = !wide;
    setWide(next);
    document.documentElement.classList.toggle('sidebar-narrow', !next);
    localStorage.setItem('sidebar', next ? 'wide' : 'narrow');
  };

  // The name only opens a category (others stay open); only the chevron closes it.
  const openGroup = (title: string) => setOpenGroups((prev) => (prev.includes(title) ? prev : [...prev, title]));
  const toggleGroup = (title: string) =>
    setOpenGroups((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  const isClosed = (title: string) => !openGroups.includes(title);

  const groups = MENU_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.lmsOnly || panelSlug === 'lms-admin') }))
    .filter((group) => group.items.length > 0);
  const activeFor = (path: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`));
  const footerButton = 'h-8 rounded-[10px] flex items-center gap-2.5 transition-all cursor-pointer text-xs font-medium';

  return (
    <aside className={`app-sidebar bg-surface-hover border-r border-sidebar-border flex flex-col h-screen fixed left-0 top-0 z-40 overflow-hidden ${wide ? 'items-stretch' : 'items-center'}`}>
      {/* Brand */}
      {/* Fixed 64px so the divider below sits at a known height; <main> starts its content 16px under it. */}
      <div className={`h-16 shrink-0 flex items-center ${wide ? 'px-2.5 gap-2' : 'justify-center'}`}>
        {/* Imported (not /siddesh_logo.png) so it loads from /lms-admin-static and never needs /_next/image,
            which on www.thinksphere360.com belongs to the ThinkSpher360 site. */}
        <Image src={siddeshLogo} alt="Siddesh Logo" width={36} height={36} unoptimized className="w-9 h-9 shrink-0 object-contain rounded-lg" />
        {wide && (
          <div className="flex-1 min-w-0 leading-tight">
            <p className="text-sm font-bold text-foreground truncate">Siddesh</p>
            <p className="text-[10px] text-zinc-500 truncate">{panelSlug === 'lms-admin' ? 'LMS Admin' : 'Lab Admin'}</p>
          </div>
        )}
      </div>
      {/* Divider between the brand and the menu */}
      <div className={`border-b border-sidebar-border ${wide ? 'mx-2.5' : 'mx-2 self-stretch'}`} />

      <nav className={`flex-1 w-full pt-4 pb-1 flex flex-col overflow-y-auto overflow-x-hidden ${wide ? 'px-2.5 gap-3' : 'px-0.5 gap-3'}`}>
        {groups.map((group, gi) => (
          wide ? (
            <div key={group.title}>
              <div className="flex items-center gap-1.5 px-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <button
                  type="button"
                  onClick={() => openGroup(group.title)}
                  className="sidebar-group-toggle flex-1 text-left uppercase tracking-wider cursor-pointer"
                >
                  {group.title}
                </button>
                {/* Folded shut but holding the current page: a dot keeps "you are here" visible. */}
                {isClosed(group.title) && group.items.some((item) => activeFor(item.path)) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-violet" />
                )}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!isClosed(group.title)}
                  aria-label={`${isClosed(group.title) ? 'Expand' : 'Collapse'} ${group.title}`}
                  className="sidebar-group-toggle -m-1 p-1 rounded cursor-pointer"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isClosed(group.title) ? '-rotate-90' : ''}`} />
                </button>
              </div>
              {/* Accordion body: grid-rows 0fr↔1fr animates the height. */}
              <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${isClosed(group.title) ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
              {/* inert: links in a folded group drop out of the Tab order */}
              <div className="overflow-hidden" inert={isClosed(group.title)}>
              {/* Tree: ├── for each page, ╰── on the last (.sidebar-tree in globals.css) */}
              <div className="sidebar-tree ml-1.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.path} className="sidebar-tree-item">
                      <Link
                        href={item.path}
                        onMouseEnter={() => prefetchFull(item.path)}
                        onFocus={() => prefetchFull(item.path)}
                        className={`sidebar-row h-8 px-2 rounded-[10px] flex items-center gap-2 text-xs font-medium ${activeFor(item.path) ? 'sidebar-row-active' : ''}`}
                      >
                        <Icon className="sidebar-row-icon w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
              </div>
              </div>
            </div>
          ) : (
            <div key={group.title} className={`flex flex-col gap-2 ${gi > 0 ? 'pt-3 border-t border-sidebar-border' : ''}`}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    title={item.label}
                    onMouseEnter={() => prefetchFull(item.path)}
                    onFocus={() => prefetchFull(item.path)}
                    className={`sidebar-rail-item flex flex-col items-center gap-0.5 text-[10px] leading-none font-medium ${activeFor(item.path) ? 'sidebar-rail-item-active' : ''}`}
                  >
                    <span className="sidebar-rail-icon w-8 h-8 rounded-[10px] flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )
        ))}
      </nav>

      {/* Narrow / wide switch, theme and logout */}
      <div className={`pb-3 pt-3 flex flex-col gap-1.5 border-t border-sidebar-border ${wide ? 'px-2.5' : 'items-center'}`}>
        <button
          type="button"
          onClick={toggleWide}
          title={wide ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={wide ? 'Collapse sidebar' : 'Expand sidebar'}
          className={`${footerButton} text-zinc-400 hover:text-foreground ${wide ? 'px-2.5 hover:bg-white/5' : 'w-8 justify-center bg-white/5 hover:bg-white/10 border border-sidebar-border'}`}
        >
          {wide ? <PanelLeftClose className="w-4 h-4 shrink-0" /> : <PanelLeftOpen className="w-4 h-4 shrink-0" />}
          {wide && 'Collapse'}
        </button>
        <button
          onClick={toggleTheme}
          title={isDark ? 'Light Theme' : 'Dark Theme'}
          aria-label={isDark ? 'Light Theme' : 'Dark Theme'}
          className={`${footerButton} ${wide ? 'px-2.5 text-zinc-400 hover:text-foreground hover:bg-white/5' : 'w-8 justify-center bg-white/5 hover:bg-white/10 border border-sidebar-border'}`}
        >
          {isDark ? <Sun className="w-4 h-4 shrink-0 text-amber-500" /> : <Moon className="w-4 h-4 shrink-0 text-slate-800" />}
          {wide && (isDark ? 'Light theme' : 'Dark theme')}
        </button>
        <button
          onClick={logout}
          title="Logout"
          aria-label="Logout"
          className={`${footerButton} text-rose-400 hover:text-rose-300 ${wide ? 'px-2.5 hover:bg-rose-500/10' : 'w-8 justify-center bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 hover:border-rose-500/25'}`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {wide && 'Logout'}
        </button>
      </div>
    </aside>
  );
}
