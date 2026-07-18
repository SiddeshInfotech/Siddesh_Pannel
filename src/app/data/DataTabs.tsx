'use client';

import { useState } from 'react';
import { School, Building2, Users } from 'lucide-react';

import SchoolsClient from './SchoolsClient';
import VendorsClient from './VendorsClient';
import ParentsClient from './ParentsClient';

interface DataTabsProps {
  initialSchools: any[];
  initialVendors: any[];
  initialParents: any[];
}

export default function DataTabs({
  initialSchools,
  initialVendors,
  initialParents,
}: DataTabsProps) {
  const [activeTab, setActiveTab] = useState<'schools' | 'vendors' | 'parents'>('schools');

  return (
    <div className="space-y-6">
      {/* Tabs Header */}
      <div className="flex gap-8 px-2 tab-header-border">
        <button
          onClick={() => setActiveTab('schools')}
          className={`pt-2 pb-4 px-4 rounded-t-xl text-sm font-bold transition-all relative tab-button-hover ${
            activeTab === 'schools' ? 'active-tab-text' : 'inactive-tab-text'
          }`}
        >
          Schools
          {activeTab === 'schools' && (
            <div className="absolute bottom-[-1px] left-4 right-4 h-[1.5px] active-tab-line" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('vendors')}
          className={`pt-2 pb-4 px-4 rounded-t-xl text-sm font-bold transition-all relative tab-button-hover ${
            activeTab === 'vendors' ? 'active-tab-text' : 'inactive-tab-text'
          }`}
        >
          Vendors
          {activeTab === 'vendors' && (
            <div className="absolute bottom-[-1px] left-4 right-4 h-[1.5px] active-tab-line" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('parents')}
          className={`pt-2 pb-4 px-4 rounded-t-xl text-sm font-bold transition-all relative tab-button-hover ${
            activeTab === 'parents' ? 'active-tab-text' : 'inactive-tab-text'
          }`}
        >
          Parents
          {activeTab === 'parents' && (
            <div className="absolute bottom-[-1px] left-4 right-4 h-[1.5px] active-tab-line" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="transition-all duration-300">
        {activeTab === 'schools' && <SchoolsClient initialSchools={initialSchools} />}
        {activeTab === 'vendors' && <VendorsClient initialVendors={initialVendors} />}
        {activeTab === 'parents' && <ParentsClient initialParents={initialParents} />}
      </div>
    </div>
  );
}