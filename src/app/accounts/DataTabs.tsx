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

  const tabs = [
    { key: 'vendors' as const, label: 'Vendors', count: initialVendors.length },
    { key: 'schools' as const, label: 'Schools', count: initialSchools.length },
    { key: 'parents' as const, label: 'Parents', count: initialParents.length },
  ];

  // Same underlined tabs as Keys / Monitoring / Update. Sits on the filter bar's bottom line.
  const tabsNode = (
    <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setActiveTab(t.key)}
          className={`filter-tab ${activeTab === t.key ? 'filter-tab-active' : ''}`}
        >
          {t.label}
          <span className="filter-tab-count">{t.count}</span>
        </button>
      ))}
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