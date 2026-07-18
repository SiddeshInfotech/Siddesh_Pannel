import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import DataTabs from './DataTabs';
import MetricCard from '@/components/MetricCard';
import { School, Building2 } from 'lucide-react';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getSchoolsData() {
  const { data: schools, error } = await supabaseAdmin
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
  
  const { data: vendors, error } = await supabaseAdmin
    .from('vendors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getVendorsData error:', error.message);
    return [];
  }

  return (vendors ?? []).map((vendor: any) => ({
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
export default async function SchoolsPage() {
  const session = await getAdminSession();

  if (!session) return null;

  const schoolsData = await getSchoolsData();

  const vendorsData = await getVendorsData();
  console.log(vendorsData);
  const totalSchools = schoolsData.length;
  const totalVendors = vendorsData.length;

  return (
    <div className="space-y-6">
  
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetricCard
          title="Total Schools"
          value={totalSchools.toString()}
          badgeText="Registered"
          badgeType="positive"
          icon={School}
        />
  
        <MetricCard
          title="Total Vendors"
          value={totalVendors.toString()}
          badgeText="Registered"
          badgeType="stable"
          icon={Building2}
        />
      </div>
  
      <DataTabs
  initialSchools={schoolsData}
  initialVendors={vendorsData}
/>
  
    </div>
  );
}
