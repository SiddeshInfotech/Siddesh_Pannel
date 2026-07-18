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
        <div className="space-y-8 max-w-6xl mx-auto relative">
            <GlassCard className="/40 border border-white/5 overflow-hidden p-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-accent-violet/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-accent-violet" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">
                                Vendors
                            </h2>
                            <p className="text-sm text-zinc-500">
                                Registered Vendors
                            </p>
                        </div>
                    </div>

                    <div className="relative">
                        <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                            size={18}
                        />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search vendors..."
                            className="pl-10 pr-4 py-2 rounded-xl border border-card-border bg-card text-sm w-72"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                                <th className="py-4 px-3.5">Vendor Name</th>
                                <th className="py-4 px-3.5">Type</th>
                                <th className="py-4 px-3.5">Category</th>
                                <th className="py-4 px-3.5">Contact</th>
                                <th className="py-4 px-3.5">Mobile</th>
                                <th className="py-4 px-3.5">Email</th>
                                <th className="py-4 px-3.5">City</th>
                                <th className="py-4 px-3.5">Status</th>
                                <th className="py-4 px-3.5">Date Added</th>
                                <th className="py-4 px-3.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredVendors.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={10}
                                        className="text-center py-10 text-zinc-500"
                                    >
                                        No vendors found.
                                    </td>
                                </tr>
                            ) : (
                                filteredVendors.map((vendor) => (
                                    <tr key={vendor.dbId} className="hover:bg-white/[0.01] transition-colors group">
                                        <td className="py-4 px-3.5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                                    <Building2 className="w-4.5 h-4.5 text-zinc-400" />
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-semibold text-white group-hover:text-accent-violet transition-colors">
                                                        {vendor.vendorName}
                                                    </h4>
                                                    <p className="text-[10px] text-zinc-500 font-medium uppercase mt-0.5">ID: {vendor.vendorId}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400 font-semibold">{vendor.vendorType}</td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400 font-medium">{vendor.businessCategory}</td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400 font-medium">{vendor.contactPerson}</td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400 font-mono">{vendor.mobile}</td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400">{vendor.email}</td>
                                        <td className="py-4 px-3.5 text-xs text-zinc-400 font-semibold">{vendor.city}</td>
                                        <td className="py-4 px-3.5">
                                            <StatusBadge status={vendor.status as any} />
                                        </td>
                                        <td className="py-4 px-3.5">
                                            <p className="text-xs font-semibold text-zinc-300">{vendor.dateAdded}</p>
                                        </td>
                                        <td className="py-4 px-3.5 text-right">
                                            <div className="flex justify-end gap-2">
                                                <Link
                                                    href={`/data/vendors/edit/${vendor.dbId}`}
                                                    className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                                                >
                                                    <Pencil size={16} />
                                                </Link>
                                                <button
                                                    onClick={() => confirmDelete(vendor)}
                                                    className="p-2 rounded-lg hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 transition-colors"
                                                >
                                                    <Trash2 size={16} />
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
          className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all"
        >
          Cancel
        </button>

        <button
          onClick={handleDelete}
          disabled={isPending}
          className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-xs font-semibold text-white rounded-xl"
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