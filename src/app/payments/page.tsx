import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import PaymentsClient from './PaymentsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getPaymentsData() {
  const { data: payments } = await supabaseAdmin
    .from('payments')
    .select(`
      id, school_id, vendor_id, parent_id, amount, keys_count, bank_name, transaction_id, payment_date, status, created_at,
      schools ( name ),
      vendors ( vendor_name ),
      parents ( parent_name )
    `)
    .order('created_at', { ascending: false });

  return (payments ?? []).map((p: any) => {
    let entityName = 'Unknown Entity';
    if (p.schools?.name) entityName = p.schools.name;
    if (p.vendors?.vendor_name) entityName = p.vendors.vendor_name;
    if (p.parents?.parent_name) entityName = p.parents.parent_name;

    return {
      id: p.id,
      schoolId: p.school_id || '',
      vendorId: p.vendor_id || '',
      parentId: p.parent_id || '',
      schoolName: entityName, // Keep this key for compatibility in PaymentsClient if preferred, or rename it. We'll rename it in PaymentsClient to `entityName`.
      entityName: entityName,
      amount: p.amount || 0,
      keysCount: p.keys_count || 0,
      bankName: p.bank_name || 'Unknown Bank',
      transactionId: p.transaction_id || '',
      paymentDate: p.payment_date
        ? new Date(p.payment_date).toISOString()
        : new Date().toISOString(),
      status: p.status || 'Unpaid',
    };
  });
}

async function getSchoolsList() {
  const { data: schools } = await supabaseAdmin
    .from('schools')
    .select('id, name')
    .order('name', { ascending: true });

  return (schools ?? []).map(s => ({ id: s.id, name: s.name }));
}

async function getVendorsList() {
  const { data: vendors } = await supabaseAdmin
    .from('vendors')
    .select('vendor_id, vendor_name')
    .order('vendor_name', { ascending: true });

  return (vendors ?? []).map(v => ({ id: v.vendor_id, name: v.vendor_name }));
}

async function getParentsList() {
  const { data: parents } = await supabaseAdmin
    .from('parents')
    .select('id, parent_name')
    .order('parent_name', { ascending: true });

  return (parents ?? []).map(p => ({ id: p.id, name: p.parent_name }));
}

export default async function PaymentsPage() {
  const session = await getAdminSession();
  if (!session) return null;

  const [initialPayments, schools, vendors, parents] = await Promise.all([
    getPaymentsData(),
    getSchoolsList(),
    getVendorsList(),
    getParentsList(),
  ]);
  return <PaymentsClient initialPayments={initialPayments} schools={schools} vendors={vendors} parents={parents} />;
}
