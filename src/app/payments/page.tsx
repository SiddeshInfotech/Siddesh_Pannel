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
      id, school_id, amount, keys_count, bank_name, transaction_id, payment_date, status, created_at,
      schools ( name )
    `)
    .order('created_at', { ascending: false });

  return (payments ?? []).map((p: any) => ({
    id: p.id,
    schoolId: p.school_id || '',
    schoolName: p.schools?.name || 'Unknown School',
    amount: p.amount || 0,
    keysCount: p.keys_count || 0,
    bankName: p.bank_name || 'Unknown Bank',
    transactionId: p.transaction_id || '',
    paymentDate: p.payment_date
      ? new Date(p.payment_date).toISOString()
      : new Date().toISOString(),
    status: p.status || 'Unpaid',
  }));
}

async function getSchoolsList() {
  const { data: schools } = await supabaseAdmin
    .from('schools')
    .select('id, name')
    .order('name', { ascending: true });

  return (schools ?? []).map(s => ({ id: s.id, name: s.name }));
}

export default async function PaymentsPage() {
  const session = await getAdminSession();
  if (!session) return null;

  // Direct fetch (page is force-dynamic): avoids the Next 16 unstable_cache
  // failure that 500'd this page in production.
  const [initialPayments, schools] = await Promise.all([
    getPaymentsData(),
    getSchoolsList(),
  ]);
  return <PaymentsClient initialPayments={initialPayments} schools={schools} />;
}
