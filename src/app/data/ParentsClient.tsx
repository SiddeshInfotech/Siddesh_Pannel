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
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                        type="text"
                        placeholder="Search parents..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-accent-violet transition-all text-white"
                    />
                </div>
            </div>

            <GlassCard className="overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/10 text-xs text-zinc-400">
                                <th className="p-4 font-semibold">PARENT ID</th>
                                <th className="p-4 font-semibold">PARENT NAME</th>
                                <th className="p-4 font-semibold">KID&apos;S NAME</th>
                                <th className="p-4 font-semibold">GRADE</th>
                                <th className="p-4 font-semibold">CONTACT</th>
                                <th className="p-4 font-semibold">STATUS</th>
                                <th className="p-4 font-semibold text-right">ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-white/5">
                            {filteredParents.map((parent) => (
                                <tr key={parent.dbId} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-accent-blue/10 flex items-center justify-center shrink-0">
                                                <Users className="w-4 h-4 text-accent-blue" />
                                            </div>
                                            <span className="font-mono text-xs text-zinc-300">{parent.parentId}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 font-semibold text-white">
                                        {parent.parentName}
                                    </td>
                                    <td className="p-4 text-zinc-400">
                                        {parent.kidName}
                                    </td>
                                    <td className="p-4 text-zinc-400">
                                        {parent.grade}
                                    </td>
                                    <td className="p-4">
                                        <div className="text-zinc-300">{parent.mobile}</div>
                                        <div className="text-xs text-zinc-500">{parent.email}</div>
                                    </td>
                                    <td className="p-4">
                                        <StatusBadge status={parent.status as StatusType} />
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {/* We can add an edit page later: href={`/parents/edit/${parent.dbId}`} */}
                                            <Link href={'#'} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors">
                                                <Pencil className="w-4 h-4" />
                                            </Link>
                                            <button 
                                                onClick={() => confirmDelete(parent)}
                                                className="p-2 hover:bg-rose-500/20 rounded-lg text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredParents.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-zinc-500 text-sm">
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
