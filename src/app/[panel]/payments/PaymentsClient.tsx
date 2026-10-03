'use client';

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState, useTransition, useEffect } from 'react';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Edit2, Trash2, XCircle, CreditCard, School, AlertCircle, AlertTriangle, X, Plus, Search, CheckCircle2, Clock } from 'lucide-react';
import EntityAvatar from '@/components/EntityAvatar';
import AppleDatePicker from '@/components/AppleDatePicker';
import GlassCard from '@/components/GlassCard';
import StatusBadge from '@/components/StatusBadge';
import { createPayment, updatePayment, deletePayment, cancelPayment } from './actions';
import { useToast } from '@/components/Toast';
import CustomSelect from '@/components/CustomSelect';

interface SchoolOption {
  id: string;
  name: string;
}

interface PaymentRow {
  id: string;
  schoolId?: string;
  vendorId?: string;
  parentId?: string;
  entityName: string;
  amount: number;
  keysCount: number;
  bankName: string;
  transactionId: string;
  paymentDate: string;
  status: 'Unpaid' | 'Pending Approval' | 'Paid';
}

interface PaymentsClientProps {
  initialPayments: PaymentRow[];
  schools: SchoolOption[];
  vendors: SchoolOption[];
  parents: SchoolOption[];
}

import { useSearchParams } from 'next/navigation';

export default function PaymentsClient({ initialPayments, schools, vendors, parents }: PaymentsClientProps) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Pending'>('All');
  // Entity dimension (image 1): All / School / Vendor / Parent. Independent of the
  // status pill below, so an admin can see e.g. "Vendor" + "Pending" together.
  const [entityTab, setEntityTab] = useState<'All' | 'School' | 'Vendor' | 'Parent'>('All');
  
  // Syncing payments with server dynamic revalidation
  const [payments, setPayments] = useState<PaymentRow[]>(initialPayments);
  const [prevInitial, setPrevInitial] = useState(initialPayments);

  if (initialPayments !== prevInitial) {
    setPrevInitial(initialPayments);
    setPayments(initialPayments);
  }

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<'School' | 'Vendor' | 'Individual'>('School');
  const [selectedSchoolId, setSelectedSchoolId] = useState(searchParams.get('schoolId') || '');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [keysCount, setKeysCount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [status, setStatus] = useState<'Unpaid' | 'Pending Approval' | 'Paid'>('Unpaid');

  // Retain for backing database updates when editing existing records
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [transactionId, setTransactionId] = useState('');

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<{ id: string; schoolName: string } | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const selectedSchool = schools.find(s => s.id === selectedSchoolId);

  const handleCancelForm = () => {
    setEditingId(null);
    setSelectedSchoolId('');
    setSelectedVendorId('');
    setSelectedParentId('');
    setKeysCount('');
    setPaymentDate('');
    setStatus('Unpaid');
    setAmount('');
    setBankName('');
    setTransactionId('');
    setShowPaymentForm(false);
  };

  const handleEdit = (payment: PaymentRow) => {
    setEditingId(payment.id);
    setEntityType(payment.schoolId ? 'School' : payment.vendorId ? 'Vendor' : payment.parentId ? 'Individual' : 'School');
    setSelectedSchoolId(payment.schoolId || '');
    setSelectedVendorId(payment.vendorId || '');
    setSelectedParentId(payment.parentId || '');
    setKeysCount(payment.keysCount.toString());
    
    setAmount(payment.amount.toString());
    setBankName(payment.bankName);
    setTransactionId(payment.transactionId);
    
    // Format date for <input type="date">
    const dateObj = new Date(payment.paymentDate);
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    setPaymentDate(`${yyyy}-${mm}-${dd}`);
    
    setStatus(payment.status);
    setShowPaymentForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (entityType === 'School' && !selectedSchoolId) ||
      (entityType === 'Vendor' && !selectedVendorId) ||
      (entityType === 'Individual' && !selectedParentId) ||
      (entityType !== 'Vendor' && !keysCount) ||
      !paymentDate
    ) {
      toast('Please fill in all the payment details.', 'error');
      return;
    }

    startTransition(async () => {
      try {
        const formData = {
          entityType,
          schoolId: selectedSchoolId,
          vendorId: selectedVendorId,
          parentId: selectedParentId,
          // Not applicable to Vendor (field is hidden) — omit rather than send NaN from
          // an empty string, which zod's optional number schema would reject outright.
          keysCount: entityType !== 'Vendor' && keysCount ? parseInt(keysCount) : undefined,
          paymentDate,
          status,
          // Forward existing values if editing, otherwise they will be defaulted/auto-generated by server action
          amount: amount ? parseFloat(amount) : undefined,
          bankName: bankName || undefined,
          transactionId: transactionId || undefined,
        };

        const res = editingId
          ? await updatePayment(editingId, formData)
          : await createPayment(formData);
        if (!res.ok) {
          toast(res.error, 'error');
          return;
        }
        toast(editingId ? 'Payment record updated successfully.' : 'Payment record added successfully.', 'success');
        handleCancelForm();
      } catch {
        toast('Something went wrong. Please try again.', 'error');
      }
    });
  };

  const confirmDelete = (id: string, entityName: string) => {
    setPaymentToDelete({ id, schoolName: entityName });
    setShowConfirmModal(true);
    toast(`⚠️ Warning: Deleting the payment record for "${entityName}" will permanently erase all connected activation key bindings!`, 'error');
  };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleCancelPayment = (id: string, entityName: string) => {
    if (confirm(`Are you sure you want to revoke/cancel the payment status to "Unpaid" for ${entityName}?`)) {
      startTransition(async () => {
        const res = await cancelPayment(id);
        if (!res.ok) {
          toast(res.error, 'error');
          return;
        }
        toast('Payment status set to Unpaid.', 'success');
      });
    }
  };

  const paymentEntity = (p: PaymentRow): 'School' | 'Vendor' | 'Parent' =>
    p.vendorId ? 'Vendor' : p.parentId ? 'Parent' : 'School';

  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const searchedPayments = q
    ? payments.filter(p => p.transactionId.toLowerCase().includes(q) || p.entityName.toLowerCase().includes(q))
    : payments;

  const tabCount = (key: string) => {
    if (key === 'All') return searchedPayments.length;
    if (key === 'School' || key === 'Vendor' || key === 'Parent') return searchedPayments.filter(p => paymentEntity(p) === key).length;
    if (key === 'Pending') return searchedPayments.filter(p => p.status === 'Pending Approval').length;
    return searchedPayments.filter(p => p.status === key).length;
  };
  const paidCount = payments.filter(p => p.status === 'Paid').length;
  const unpaidCount = payments.filter(p => p.status === 'Unpaid').length;
  const pendingCount = payments.filter(p => p.status === 'Pending Approval').length;

  const filteredPayments = searchedPayments.filter(p => {
    if (entityTab !== 'All' && paymentEntity(p) !== entityTab) return false;
    if (filter === 'Paid') return p.status === 'Paid';
    if (filter === 'Unpaid') return p.status === 'Unpaid';
    if (filter === 'Pending') return p.status === 'Pending Approval';
    return true;
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto relative">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header & Filters Panel */}
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-2xl font-bold text-foreground">Payments</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="stat-chip"><CreditCard className="w-3.5 h-3.5 text-accent-violet" /> All payments <span className="stat-chip-value">{payments.length}</span></span>
            <span className="stat-chip"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Paid <span className="stat-chip-value">{paidCount}</span></span>
            <span className="stat-chip"><XCircle className="w-3.5 h-3.5 text-rose-500" /> Unpaid <span className="stat-chip-value">{unpaidCount}</span></span>
            <span className="stat-chip"><Clock className="w-3.5 h-3.5 text-amber-500" /> Pending <span className="stat-chip-value">{pendingCount}</span></span>
          </div>
        </div>

        {/* Filter bar — underlined tabs with counts; search + Add Payment on the right. */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
          <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
            <button
              type="button"
              onClick={() => { setEntityTab('All'); setFilter('All'); }}
              className={`filter-tab ${entityTab === 'All' && filter === 'All' ? 'filter-tab-active' : ''}`}
            >
              All <span className="filter-tab-count">{tabCount('All')}</span>
            </button>
            {(['School', 'Vendor', 'Parent'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setEntityTab(t); setFilter('All'); }}
                className={`filter-tab ${entityTab === t && filter === 'All' ? 'filter-tab-active' : ''}`}
              >
                {t} <span className="filter-tab-count">{tabCount(t)}</span>
              </button>
            ))}
            {(['Paid', 'Unpaid', 'Pending'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => { setFilter(f); setEntityTab('All'); }}
                className={`filter-tab ${filter === f && entityTab === 'All' ? 'filter-tab-active' : ''}`}
              >
                {f} <span className="filter-tab-count">{tabCount(f)}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
            <div className="relative flex-1 xl:w-[260px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search transaction ID or entity…"
                className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setShowPaymentForm(true);
              }}
              className="btn btn-secondary !h-8 !px-3 !text-xs shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Payment
            </button>
          </div>
        </div>
      </div>

      {/* Payment Table Records */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Entity Name</th>
                <th>Date</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.length > 0 ? (
                filteredPayments.map(payment => (
                  <tr key={payment.id} className="group">
                    <td>
                      <span className="cell-strong cell-mono">{payment.transactionId}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <EntityAvatar name={payment.entityName || '?'} />
                        <span>{payment.entityName}</span>
                      </div>
                    </td>
                    <td>
                      <span className="cell-muted cell-num">
                        {payment.paymentDate ? (() => {
                          const date = new Date(payment.paymentDate);
                          const day = String(date.getDate()).padStart(2, '0');
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const year = date.getFullYear();
                          return `${day}/${month}/${year}`;
                        })() : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={payment.status === 'Paid' ? 'Paid' : payment.status === 'Unpaid' ? 'Unpaid' : 'Pending'} />
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(payment)}
                          className="icon-btn"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmDelete(payment.id, payment.entityName)}
                          className="icon-btn icon-btn-danger"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="!h-auto py-12 text-center text-zinc-500 text-sm">
                    <AlertCircle className="w-5 h-5 mx-auto mb-2 text-zinc-600" />
                    No payments found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Confirmation Modal */}
      {showConfirmModal && paymentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-md p-6 space-y-6 relative">
            <button 
              onClick={() => {
                setShowConfirmModal(false);
                setPaymentToDelete(null);
              }}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Confirm Payment Deletion</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Are you absolutely sure you want to delete the payment record for <strong className="text-zinc-200">{paymentToDelete.schoolName}</strong>?
                </p>
                <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-rose-400 font-semibold leading-relaxed">
                    ⚠️ CRITICAL NOTE: All associated cryptographic activation keys linked to this receipt will be permanently deleted from the database.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setPaymentToDelete(null);
                }}
                disabled={isPending}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all cursor-pointer disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  startTransition(async () => {
                    const res = await deletePayment(paymentToDelete.id);
                    if (!res.ok) {
                      toast(res.error, 'error');
                      return;
                    }
                    toast('Payment record deleted successfully.', 'success');
                    setShowConfirmModal(false);
                    setPaymentToDelete(null);
                  });
                }}
                disabled={isPending}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-all cursor-pointer disabled:opacity-55"
              >
                {isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-4xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={handleCancelForm}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <form onSubmit={handleSubmit} className="space-y-6 mt-2">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {editingId ? 'Edit Payment Details' : 'Add Payment Details'}
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  {editingId ? 'Modify registered payment details.' : 'Submit and log verified payment transactions.'}
                </p>
              </div>

              {/* Entity Type Selection */}
              <div className="w-full md:w-1/2 mb-6">
                <label className="text-xs font-bold text-zinc-400 block mb-2">Entity Type</label>
                <CustomSelect
                  required
                  value={entityType}
                  onChange={val => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setEntityType(val as any);
                    setSelectedSchoolId('');
                    setSelectedVendorId('');
                    setSelectedParentId('');
                    if (val === 'Vendor') setKeysCount('');
                  }}
                  options={[
                    { value: 'School', label: 'School' },
                    { value: 'Vendor', label: 'Vendor' },
                    { value: 'Individual', label: 'Normal Individual User' }
                  ]}
                  placeholder="Select Entity Type"
                />
              </div>

              {/* Form Inputs Grid */}
              <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-6">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-accent-violet" />
                  Payment info
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {entityType === 'School' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 block">Select Institution *</label>
                      <CustomSelect
                        required
                        value={selectedSchoolId}
                        onChange={val => setSelectedSchoolId(val)}
                        options={schools.map(s => ({ value: s.id, label: s.name }))}
                        placeholder="Select School"
                      />
                    </div>
                  )}
                  
                  {entityType === 'Vendor' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 block">Select Vendor *</label>
                      <CustomSelect
                        required
                        value={selectedVendorId}
                        onChange={val => setSelectedVendorId(val)}
                        options={vendors.map(v => ({ value: v.id, label: v.name }))}
                        placeholder="Select Vendor"
                      />
                    </div>
                  )}

                  {entityType === 'Individual' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 block">Select Individual *</label>
                      <CustomSelect
                        required
                        value={selectedParentId}
                        onChange={val => setSelectedParentId(val)}
                        options={parents.map(p => ({ value: p.id, label: p.name }))}
                        placeholder="Select Individual"
                      />
                    </div>
                  )}

                  {entityType !== 'Vendor' && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-400 block">Keys Issued Count *</label>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 5"
                        value={keysCount}
                        onChange={e => setKeysCount(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 block">Payment Date *</label>
                    <AppleDatePicker 
                      value={paymentDate}
                      onChange={setPaymentDate}
                      placeholder="mm/dd/yyyy"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 block">Audit Clearance Status *</label>
                    <CustomSelect
                      required
                      value={status}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onChange={val => setStatus(val as any)}
                      options={[
                        { value: 'Unpaid', label: 'Unpaid (Draft / Flagged)' },
                        { value: 'Pending Approval', label: 'Pending Approval (Awaiting Clearance)' },
                        { value: 'Paid', label: 'Paid (Verified & Approved)' }
                      ]}
                      placeholder="Select Status"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10 mt-6">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  disabled={isPending}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn btn-primary"
                >
                  {isPending ? 'Saving...' : editingId ? 'Update Receipt' : 'Submit Receipt'}
                </button>
              </div>
            </form>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
