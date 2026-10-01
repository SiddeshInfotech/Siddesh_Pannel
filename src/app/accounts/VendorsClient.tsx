'use client';

import { useMemo, useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import FormModal from '@/components/FormModal';
import NewVendorForm from '@/components/forms/NewVendorForm';
import { getVendorForEdit, type VendorEditData } from './actions';
import {
    Pencil,
    Trash2,
    Search,
    Plus,
} from 'lucide-react';

import GlassCard from '@/components/GlassCard';
import EntityAvatar from '@/components/EntityAvatar';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import {
  AlertTriangle,
  X
} from 'lucide-react';

import { deleteVendorAction } from './actions';

interface Vendor {
    dbId: string;
    vendorId: string;
    vendorName: string;
    vendorType: string;
    businessCategory: string;
    contactPerson: string;
    mobile: string;
    email: string;
    city: string;
    status: string;
    dateAdded: string;
}

interface VendorsClientProps {
    initialVendors: Vendor[];
    tabsNode?: React.ReactNode;
}

export default function VendorsClient({
    initialVendors,
    tabsNode,
}: VendorsClientProps) {

    const [vendors, setVendors] = useState(initialVendors);
    // Keep the list in step with fresh server data (router.refresh() after adding from the pop-up).
    const [prevInitial, setPrevInitial] = useState(initialVendors);
    if (initialVendors !== prevInitial) {
        setPrevInitial(initialVendors);
        setVendors(initialVendors);
    }
    const router = useRouter();
    const [showAdd, setShowAdd] = useState(false);
    const closeAdd = useCallback(() => setShowAdd(false), []);

    const [search, setSearch] = useState('');

    const { toast } = useToast();

    const [isPending, startTransition] = useTransition();

    const [showConfirmModal, setShowConfirmModal] = useState(false);

const [vendorToDelete, setVendorToDelete] =
    useState<Vendor | null>(null);

    const filteredVendors = useMemo(() => {
        if (!search.trim()) return vendors;

        const value = search.toLowerCase();

        return vendors.filter((vendor) =>
            vendor.vendorName.toLowerCase().includes(value) ||
            vendor.vendorId.toLowerCase().includes(value) ||
            vendor.contactPerson.toLowerCase().includes(value) ||
            vendor.mobile.toLowerCase().includes(value)
        );
    }, [vendors, search]);
    const confirmDelete = (vendor: Vendor) => {
        setVendorToDelete(vendor);
        setShowConfirmModal(true);
    };
    
    const handleDelete = () => {
        if (!vendorToDelete) return;
    
        const targetId = vendorToDelete.dbId;
        const targetName = vendorToDelete.vendorName;
    
        startTransition(async () => {
    
            const result = await deleteVendorAction(targetId);
    
            if (!result.ok) {
                toast(result.error, 'error');
                return;
            }
    
            setVendors(prev =>
                prev.filter(v => v.dbId !== targetId)
            );
    
            toast(
                `Vendor "${targetName}" deleted successfully.`,
                'success'
            );
    
            setShowConfirmModal(false);
            setVendorToDelete(null);
    
        });
    };
    const [editVendor, setEditVendor] = useState<VendorEditData | null>(null);
    const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
    const openEdit = async (id: string) => {
        setLoadingEditId(id);
        try {
            const v = await getVendorForEdit(id);
            if (v) setEditVendor(v);
            else toast('Could not load this vendor. Please try again.', 'error');
        } finally {
            setLoadingEditId(null);
        }
    };

    return (
        <div className="space-y-4 relative">
            <FormModal open={showAdd} onClose={closeAdd}>
                <NewVendorForm onClose={closeAdd} onSaved={() => { closeAdd(); router.refresh(); }} />
            </FormModal>
            <FormModal open={!!editVendor} onClose={() => setEditVendor(null)}>
                {editVendor && (
                    <NewVendorForm
                        key={editVendor.dbId}
                        vendor={editVendor}
                        onClose={() => setEditVendor(null)}
                        onSaved={() => { setEditVendor(null); router.refresh(); }}
                    />
                )}
            </FormModal>
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
                {tabsNode}
                <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
                    <div className="relative flex-1 xl:w-[260px]">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search vendors…"
                            className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowAdd(true)}
                        className="btn btn-secondary !h-8 !px-3 !text-xs shrink-0 whitespace-nowrap"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add Vendor
                    </button>
                </div>
            </div>
            <GlassCard className="overflow-hidden !p-0">
                <div className="overflow-x-auto px-[15px] py-2.5">
                    <table className="data-table data-table-rich">
                        <thead>
                            <tr>
                                <th>Vendor Name</th>
                                <th>Type</th>
                                <th>Category</th>
                                <th>Contact</th>
                                <th>Mobile</th>
                                <th>Email</th>
                                <th>City</th>
                                <th>Status</th>
                                <th>Date Added</th>
                                <th className="num">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredVendors.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
                                        No vendors found.
                                    </td>
                                </tr>
                            ) : (
                                filteredVendors.map((vendor) => (
                                    <tr key={vendor.dbId}>
                                        <td>
                                            <div className="flex items-center gap-2.5">
                                                <EntityAvatar name={vendor.vendorName || '?'} size={32} />
                                                <div>
                                                    <span className="block cell-strong">{vendor.vendorName}</span>
                                                    <span className="block cell-sub">ID: {vendor.vendorId}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{vendor.vendorType}</td>
                                        <td>{vendor.businessCategory}</td>
                                        <td>{vendor.contactPerson}</td>
                                        <td className="cell-num">{vendor.mobile}</td>
                                        <td className="cell-muted">{vendor.email}</td>
                                        <td>{vendor.city}</td>
                                        <td>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            <StatusBadge status={vendor.status as any} />
                                        </td>
                                        <td className="cell-muted cell-num">{vendor.dateAdded}</td>
                                        <td className="num">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(vendor.dbId)}
                                                    disabled={loadingEditId === vendor.dbId}
                                                    className="icon-btn"
                                                    title="Edit Vendor"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => confirmDelete(vendor)}
                                                    className="icon-btn icon-btn-danger"
                                                    title="Delete Vendor"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </GlassCard>

{/* Confirmation Modal */}
{showConfirmModal && vendorToDelete && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
    <GlassCard className="popup-panel animate-slide-up w-full max-w-md p-6 space-y-6 relative">

      <button
        onClick={() => {
          setShowConfirmModal(false);
          setVendorToDelete(null);
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

          <h3 className="text-lg font-bold text-white">
            Delete Vendor
          </h3>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Are you sure you want to delete
            <strong className="text-zinc-200">
              {" "}{vendorToDelete.vendorName}
            </strong>
            ?
          </p>

          <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mt-2">
            <p className="text-[10px] text-rose-400 font-semibold leading-relaxed">
              This action permanently removes the vendor from the database.
            </p>
          </div>

        </div>

      </div>

      <div className="flex justify-end gap-3 pt-2">

        <button
          onClick={() => {
            setShowConfirmModal(false);
            setVendorToDelete(null);
          }}
          disabled={isPending}
          className="btn btn-secondary"
        >
          Cancel
        </button>

        <button
          onClick={handleDelete}
          disabled={isPending}
          className="btn btn-primary !bg-rose-600"
        >
          {isPending ? 'Deleting...' : 'Confirm Delete'}
        </button>

      </div>

    </GlassCard>
  </div>
)}

</div>
);
}