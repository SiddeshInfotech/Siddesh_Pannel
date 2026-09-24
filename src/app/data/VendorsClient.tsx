'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
    Building2,
    Pencil,
    Trash2,
    Search,
} from 'lucide-react';

import GlassCard from '@/components/GlassCard';
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
}

export default function VendorsClient({
    initialVendors,
}: VendorsClientProps) {

    const [vendors, setVendors] = useState(initialVendors);

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
    return (
        <div className="space-y-6 relative">
            <GlassCard className="overflow-hidden p-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5">
                    <div className="flex items-center gap-3">
                        <span className="metric-icon">
                            <Building2 className="w-4 h-4 text-foreground" />
                        </span>
                        <div>
                            <h2 className="text-base font-semibold text-foreground">Vendors</h2>
                            <p className="page-subtitle !mt-0.5">{filteredVendors.length} registered</p>
                        </div>
                    </div>
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search vendors..."
                            className="field-input pl-9"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="ui-table">
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
                                    <td colSpan={10} className="text-center !py-10">
                                        No vendors found.
                                    </td>
                                </tr>
                            ) : (
                                filteredVendors.map((vendor) => (
                                    <tr key={vendor.dbId}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <span className="metric-icon">
                                                    <Building2 className="w-4 h-4 text-foreground" />
                                                </span>
                                                <div>
                                                    <span className="block font-semibold text-foreground">{vendor.vendorName}</span>
                                                    <span className="block text-[11px] text-zinc-500 mt-0.5">ID: {vendor.vendorId}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{vendor.vendorType}</td>
                                        <td>{vendor.businessCategory}</td>
                                        <td>{vendor.contactPerson}</td>
                                        <td className="font-mono">{vendor.mobile}</td>
                                        <td>{vendor.email}</td>
                                        <td>{vendor.city}</td>
                                        <td>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                            <StatusBadge status={vendor.status as any} />
                                        </td>
                                        <td>{vendor.dateAdded}</td>
                                        <td className="num">
                                            <div className="flex justify-end gap-2">
                                                <Link
                                                    href={`/data/vendors/edit/${vendor.dbId}`}
                                                    className="btn btn-secondary !h-8 !px-2.5"
                                                    title="Edit Vendor"
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </Link>
                                                <button
                                                    onClick={() => confirmDelete(vendor)}
                                                    className="btn btn-secondary !h-8 !px-2.5 text-rose-500"
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
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
    <GlassCard className="w-full max-w-md border border-white/10 p-6 space-y-6 shadow-2xl relative">

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