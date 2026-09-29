import React from 'react';
import { getAdminSession } from '@/lib/auth';
import DataTabs from './DataTabs';
import type { Metadata } from 'next';
import { APP_PANEL } from '@/lib/appPanel';
import MetricCard from '@/components/MetricCard';
import MetricGroup from '@/components/MetricGroup';
import { School, Building2, Users } from 'lucide-react';
import { adminDb } from '@/lib/panelTables';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getSchoolsData() {
  const { data: schools, error } = await (await adminDb())
    .from('schools')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getSchoolsData error:', error.message);
    return [];
  }

  return (schools ?? []).map(sch => ({
    dbId: sch.id,
    id: sch.school_id || sch.id,
    name: sch.name,
    board: sch.board,
    mediums: sch.mediums || [],
    academicYear: sch.academic_year || 'N/A',
    section: sch.section || 'N/A',
    standard: sch.standard || 'N/A',
    fullClassName: sch.full_class_name || 'N/A',
    devicesUsed: sch.classrooms_count || 0,
    status: sch.status === 'Active' ? 'OPERATIONAL' : 'DRAFT',
    lastSync: sch.created_at ? new Date(sch.created_at).toLocaleDateString() : 'N/A',
    gateway: sch.city?.toUpperCase() || 'N/A',
  }));
}

async function getVendorsData() {
  const { data: vendors, error } = await (await adminDb())
    .from('vendors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getVendorsData error:', error.message);
    return [];
  }
  console.log("VENDORS DB RESULT:", vendors[0]);

  return (vendors ?? []).map((vendor: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: vendor.vendor_id,
    dbId: vendor.vendor_id,
    vendorId: vendor.vendor_id,

    vendorName: vendor.vendor_name,
    vendorType: vendor.vendor_type,
    businessCategory: vendor.business_category,
    contactPerson: vendor.contact_person_name,
    mobile: vendor.mobile_number,
    email: vendor.email_address,
    city: vendor.city,
    status: vendor.status,
    dateAdded: vendor.created_at
      ? new Date(vendor.created_at).toLocaleDateString()
      : 'N/A',
  }));
}

async function getParentsData() {
  const { data: parents, error } = await (await adminDb())
    .from('parents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getParentsData error:', error.message);
    return [];
  }

  return (parents ?? []).map((parent: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: parent.parent_id,
    dbId: parent.id,
    parentId: parent.parent_id,
    parentName: parent.parent_name,
    kidName: parent.kid_name,
    email: parent.email,
    mobile: parent.phone_number,
    city: parent.city,
    grade: parent.grade,
    status: parent.status,
    dateAdded: parent.created_at
      ? new Date(parent.created_at).toLocaleDateString()
      : 'N/A',
  }));
}

export const metadata: Metadata = {
  title: `Accounts · ${APP_PANEL === 'lab' ? 'Lab' : 'LMS'} Admin Console`,
};

export default async function AccountsPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  const session = await getAdminSession();

  if (!session) return null;

  const schoolsData = await getSchoolsData();
  const vendorsData = await getVendorsData();
  const parentsData = await getParentsData();

  const totalSchools = schoolsData.length;
  const totalVendors = vendorsData.length;
  const totalParents = parentsData.length;

  return (
    <div className="space-y-8 w-full">
      <div className="h-6" />
      
      <div className="space-y-4">
        <MetricGroup className="grid-cols-1 md:grid-cols-3">
        <MetricCard
          title="Total Schools"
          value={totalSchools.toString()}
          icon={School}
        />

        <MetricCard
          title="Total Vendors"
          value={totalVendors.toString()}
          icon={Building2}
        />

        <MetricCard
          title="Total Parents"
          value={totalParents.toString()}
          icon={Users}
        />
      </MetricGroup>

      <DataTabs
        initialSchools={schoolsData}
        initialVendors={vendorsData}
        initialParents={parentsData}
        initialTab={(searchParams.tab === 'schools' || searchParams.tab === 'parents') ? searchParams.tab : 'vendors'}
      />
      </div>
    </div>
  );
}
