'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
    Users,
    Pencil,
    Trash2,
    Search,
    AlertTriangle,
    X
} from 'lucide-react';

import GlassCard from '@/components/GlassCard';
import StatusBadge, { StatusType } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { deleteParentAction } from './actions';

interface Parent {
    dbId: string;
    parentId: string;
    parentName: string;
    kidName: string;
    email: string;
    mobile: string;
    city: string;
    grade: string;
    status: StatusType;
    dateAdded: string;
}

interface ParentsClientProps {
    initialParents: Parent[];
}

export default function ParentsClient({
    initialParents,
}: ParentsClientProps) {
    const [parents, setParents] = useState(initialParents);
    const [search, setSearch] = useState('');
    const { toast } = useToast();
    const [isPending, startTransition] = useTransition();
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [parentToDelete, setParentToDelete] = useState<Parent | null>(null);

    const filteredParents = useMemo(() => {
        if (!search.trim()) return parents;

        const value = search.toLowerCase();

        return parents.filter((parent) =>
            parent.parentName.toLowerCase().includes(value) ||
            parent.parentId.toLowerCase().includes(value) ||
            parent.kidName.toLowerCase().includes(value) ||
            parent.email.toLowerCase().includes(value) ||
            parent.mobile.toLowerCase().includes(value)
        );
    }, [parents, search]);

    const confirmDelete = (parent: Parent) => {
        setParentToDelete(parent);
        setShowConfirmModal(true);
    };
    
    const handleDelete = () => {
        if (!parentToDelete) return;
    
        const targetId = parentToDelete.dbId;
        const targetName = parentToDelete.parentName;
    
        startTransition(async () => {
            const result = await deleteParentAction(targetId);
    
            if (!result.ok) {
                toast(result.error, 'error');
                return;
            }
    
            setParents(prev => prev.filter(p => p.dbId !== targetId));
            toast(`Parent "${targetName}" deleted successfully.`, 'success');
            setShowConfirmModal(false);
            setParentToDelete(null);
        });
    };

    return (
        <div className="space-y-6">
            <GlassCard className="overflow-hidden p-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5">
                    <div className="flex items-center gap-3">
                        <span className="metric-icon">
                            <Users className="w-4 h-4 text-foreground" />
                        </span>
                        <div>
                            <h2 className="text-base font-semibold text-foreground">Parents</h2>
                            <p className="page-subtitle !mt-0.5">{filteredParents.length} registered</p>
                        </div>
                    </div>
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search parents..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="field-input pl-9"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Parent ID</th>
                                <th>Parent Name</th>
                                <th>Kid&apos;s Name</th>
                                <th>Grade</th>
                                <th>Contact</th>
                                <th>Status</th>
                                <th className="num">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredParents.map((parent) => (
                                <tr key={parent.dbId}>
                                    <td>
                                        <div className="flex items-center gap-3">
                                            <span className="metric-icon">
                                                <Users className="w-4 h-4 text-foreground" />
                                            </span>
                                            <span className="font-mono">{parent.parentId}</span>
                                        </div>
                                    </td>
                                    <td className="font-semibold text-foreground">{parent.parentName}</td>
                                    <td>{parent.kidName}</td>
                                    <td>{parent.grade}</td>
                                    <td>
                                        <span className="block">{parent.mobile}</span>
                                        <span className="block text-[11px] text-zinc-500 mt-0.5">{parent.email}</span>
                                    </td>
                                    <td>
                                        <StatusBadge status={parent.status as StatusType} />
                                    </td>
                                    <td className="num">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* We can add an edit page later: href={`/parents/edit/${parent.dbId}`} */}
                                            <Link href={'#'} className="btn btn-secondary !h-8 !px-2.5" title="Edit Parent">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Link>
                                            <button
                                                onClick={() => confirmDelete(parent)}
                                                className="btn btn-secondary !h-8 !px-2.5 text-rose-500"
                                                title="Delete Parent"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredParents.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center !py-10">
                                        No parents found matching your search.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </GlassCard>

            {/* Custom Confirm Dialog (same logic as VendorsClient) */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-[#121216] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                        <div className="p-5 border-b border-white/5 flex justify-between items-center">
                            <div className="flex items-center gap-2 text-rose-400">
                                <AlertTriangle className="w-5 h-5" />
                                <h3 className="font-bold">Delete Parent</h3>
                            </div>
                            <button 
                                onClick={() => setShowConfirmModal(false)}
                                className="text-zinc-500 hover:text-white transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <p className="text-sm text-zinc-300">
                                Are you sure you want to delete <span className="font-bold text-white">{parentToDelete?.parentName}</span>?
                            </p>
                            <p className="text-xs text-zinc-500">
                                This action cannot be undone. All data associated with this parent will be permanently removed.
                            </p>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isPending}
                                    className="flex-1 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-sm font-semibold rounded-xl transition-colors border border-rose-500/20 cursor-pointer disabled:opacity-50"
                                >
                                    {isPending ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
