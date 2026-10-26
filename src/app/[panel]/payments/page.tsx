import React from 'react';
import { getAdminSession } from '@/lib/auth';
import PaymentsClient from './PaymentsClient';
import { adminDb } from '@/lib/panelTables';
import { getEntityLists } from '@/lib/entityLists';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getPaymentsData() {
  const { data: payments } = await (await adminDb())
    .from('payments')
    .select(`
      id, school_id, vendor_id, parent_id, amount, keys_count, bank_name, transaction_id, payment_date, status, created_at,
      schools ( name ),
      vendors ( vendor_name ),
      parents ( parent_name )
    `)
    .order('created_at', { ascending: false });

  return (payments ?? []).map((p: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
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

export default async function PaymentsPage() {
  const session = await getAdminSession();
  if (!session) return null;

  // Picker lists come from the data cache (src/lib/entityLists.ts); payments are always live.
  const [initialPayments, { schools, vendors, parents }] = await Promise.all([
    getPaymentsData(),
    getEntityLists(session.panel),
  ]);
  return <PaymentsClient initialPayments={initialPayments} schools={schools} vendors={vendors} parents={parents} />;
}
