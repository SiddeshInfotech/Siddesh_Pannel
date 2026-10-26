import React from 'react';
import { getAdminSession } from '@/lib/auth';
import DataTabs from './DataTabs';
import { School, Building2, Users } from 'lucide-react';
import { adminDb } from '@/lib/panelTables';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAllPages } from '../update/telemetry';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Set once PostgREST reports the function missing (PGRST202), so later loads skip straight to the fallback.
let keyCountsRpcMissing = false;

// Number of licence keys per owner (activation_keys.school_id / vendor_id / parent_id).
async function getKeyCounts() {
  const db = await adminDb();
  const count = { school: new Map<string, number>(), vendor: new Map<string, number>(), parent: new Map<string, number>() };

  // Counted inside Postgres (key-counts-by-owner.sql): one small row per owner instead of every key.
  if (!keyCountsRpcMissing) {
    const { data: rows, error } = await supabaseAdmin.rpc('key_counts_by_owner', { p_panel: db.panel });
    if (!error && Array.isArray(rows)) {
      for (const r of rows as { owner_type: string; owner_id: string; n: number | string }[]) {
        if (r.owner_type === 'school' || r.owner_type === 'vendor' || r.owner_type === 'parent') count[r.owner_type].set(r.owner_id, Number(r.n));
      }
      return count;
    }
    if (error?.code === 'PGRST202') keyCountsRpcMissing = true;
  }

  // Fallback until that SQL function is installed: download the owner columns and count here.
  const { data } = await fetchAllPages<{ school_id: string | null; vendor_id: string | null; parent_id: string | null }>((from, to) =>
    db.from('activation_keys').select('school_id, vendor_id, parent_id').order('id').range(from, to), 200_000);
  const bump = (m: Map<string, number>, id: string | null) => { if (id) m.set(id, (m.get(id) ?? 0) + 1); };
  for (const k of data) {
    bump(count.school, k.school_id);
    bump(count.vendor, k.vendor_id);
    bump(count.parent, k.parent_id);
  }
  return count;
}
type KeyCounts = Awaited<ReturnType<typeof getKeyCounts>>;

async function getSchoolsData(keyCountsP: Promise<KeyCounts>) {
  const [{ data: schools, error }, keyCounts] = await Promise.all([
    (await adminDb()).from('schools').select('*').order('created_at', { ascending: false }),
    keyCountsP,
  ]);

  if (error) {
    console.error('getSchoolsData error:', error.message);
    return [];
  }

  return (schools ?? []).map(sch => ({
    dbId: sch.id,
    id: sch.school_id ?? '', // public SCH-YYYY-NNNN id only — never the internal UUID
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
    keyCount: keyCounts.school.get(sch.id) ?? 0,
  }));
}

async function getVendorsData(keyCountsP: Promise<KeyCounts>) {
  const [{ data: vendors, error }, keyCounts] = await Promise.all([
    (await adminDb()).from('vendors').select('*').order('created_at', { ascending: false }),
    keyCountsP,
  ]);
  if (error) {
    console.error('getVendorsData error:', error.message);
    return [];
  }

  return (vendors ?? []).map((vendor: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: vendor.vendor_id,
    dbId: vendor.vendor_id,
    vendorId: vendor.vendor_id ?? '',

    vendorName: vendor.vendor_name,
    vendorType: vendor.vendor_type,
    businessCategory: vendor.business_category,
    contactPerson: vendor.contact_person_name,
    mobile: vendor.mobile_number,
    email: vendor.email_address,
    city: vendor.city,
    status: vendor.status,
    keyCount: keyCounts.vendor.get(vendor.vendor_id) ?? 0,
    dateAdded: vendor.created_at
      ? new Date(vendor.created_at).toLocaleDateString()
      : 'N/A',
  }));
}

async function getParentsData(keyCountsP: Promise<KeyCounts>) {
  const [{ data: parents, error }, keyCounts] = await Promise.all([
    (await adminDb()).from('parents').select('*').order('created_at', { ascending: false }),
    keyCountsP,
  ]);
  if (error) {
    console.error('getParentsData error:', error.message);
    return [];
  }

  return (parents ?? []).map((parent: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => ({
    id: parent.parent_id ?? '',
    dbId: parent.id,
    parentId: parent.parent_id ?? '', // public PAR-YYYY-NNNN id only — never the internal UUID
    parentName: parent.parent_name,
    kidName: parent.kid_name,
    email: parent.email,
    mobile: parent.phone_number,
    city: parent.city,
    grade: parent.grade,
    status: parent.status,
    keyCount: keyCounts.parent.get(parent.id) ?? 0,
    dateAdded: parent.created_at
      ? new Date(parent.created_at).toLocaleDateString()
      : 'N/A',
  }));
}


export default async function AccountsPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const searchParams = await props.searchParams;
  const session = await getAdminSession();

  if (!session) return null;

  // Independent queries: run them in parallel, not one after another. The key counts are only
  // needed to fill in each row, so every list query starts at once and waits for them at the end.
  const keyCounts = getKeyCounts();
  const [schoolsData, vendorsData, parentsData] = await Promise.all([
    getSchoolsData(keyCounts),
    getVendorsData(keyCounts),
    getParentsData(keyCounts),
  ]);

  const totalSchools = schoolsData.length;
  const totalVendors = vendorsData.length;
  const totalParents = parentsData.length;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Spacer to maintain layout height */}
      <div className="h-10" />

      <div className="space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-4 pb-2">
          <h2 className="text-2xl font-bold text-foreground">Accounts</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="stat-chip"><Building2 className="w-3.5 h-3.5 text-accent-violet" /> Vendors <span className="stat-chip-value">{totalVendors}</span></span>
            <span className="stat-chip"><School className="w-3.5 h-3.5 text-sky-500" /> Schools <span className="stat-chip-value">{totalSchools}</span></span>
            <span className="stat-chip"><Users className="w-3.5 h-3.5 text-emerald-500" /> Parents <span className="stat-chip-value">{totalParents}</span></span>
          </div>
        </div>

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
