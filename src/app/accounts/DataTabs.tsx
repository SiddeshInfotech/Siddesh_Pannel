'use client';

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useState, useEffect } from 'react';


import SchoolsClient from './SchoolsClient';
import VendorsClient from './VendorsClient';
import ParentsClient from './ParentsClient';

interface DataTabsProps {
  initialSchools: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[];
  initialVendors: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[];
  initialParents: any /* eslint-disable-line @typescript-eslint/no-explicit-any */[];
  initialTab?: 'schools' | 'vendors' | 'parents';
}

export default function DataTabs({
  initialSchools,
  initialVendors,
  initialParents,
  initialTab = 'vendors',
}: DataTabsProps) {
  const [activeTab, setActiveTab] = useState<'schools' | 'vendors' | 'parents'>(initialTab);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);

  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab);
    setActiveTab(initialTab);
  }

  const tabsNode = (
    <div className="flex h-10 p-1 items-center gap-1 bg-[var(--surface-hover)] rounded-full w-fit">
      <button
        onClick={() => setActiveTab('vendors')}
        className={`px-6 h-full flex items-center justify-center rounded-full text-[13px] font-semibold border transition-colors duration-300 outline-none ${
          activeTab === 'vendors' 
            ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm border-[var(--card-border)]' 
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]'
        }`}
      >
        Vendors
      </button>

      <button
        onClick={() => setActiveTab('schools')}
        className={`px-6 h-full flex items-center justify-center rounded-full text-[13px] font-semibold border transition-colors duration-300 outline-none ${
          activeTab === 'schools' 
            ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm border-[var(--card-border)]' 
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]'
        }`}
      >
        Schools
      </button>

      <button
        onClick={() => setActiveTab('parents')}
        className={`px-6 h-full flex items-center justify-center rounded-full text-[13px] font-semibold border transition-colors duration-300 outline-none ${
          activeTab === 'parents' 
            ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm border-[var(--card-border)]' 
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]'
        }`}
      >
        Parents
      </button>
    </div>
  );

  return (
    <div className="transition-all duration-300">
      {activeTab === 'schools' && <SchoolsClient initialSchools={initialSchools} tabsNode={tabsNode} />}
      {activeTab === 'vendors' && <VendorsClient initialVendors={initialVendors} tabsNode={tabsNode} />}
      {activeTab === 'parents' && <ParentsClient initialParents={initialParents} tabsNode={tabsNode} />}
    </div>
  );
}