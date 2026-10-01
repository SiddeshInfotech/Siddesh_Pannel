'use client';

import { useMemo, useState, useTransition, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import FormModal from '@/components/FormModal';
import NewParentForm from '@/components/forms/NewParentForm';
import {
    Pencil,
    Trash2,
    Search,
    Plus,
    AlertTriangle,
    X
} from 'lucide-react';

import GlassCard from '@/components/GlassCard';
import EntityAvatar from '@/components/EntityAvatar';
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
    tabsNode?: React.ReactNode;
}

export default function ParentsClient({
    initialParents,
    tabsNode,
}: ParentsClientProps) {
    const [parents, setParents] = useState(initialParents);
    // Keep the list in step with fresh server data (router.refresh() after adding from the pop-up).
    const [prevInitial, setPrevInitial] = useState(initialParents);
    if (initialParents !== prevInitial) {
        setPrevInitial(initialParents);
        setParents(initialParents);
    }
    const router = useRouter();
    const [showAdd, setShowAdd] = useState(false);
    const closeAdd = useCallback(() => setShowAdd(false), []);
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
        <div className="space-y-4">
            <FormModal open={showAdd} onClose={closeAdd}>
                <NewParentForm onClose={closeAdd} onSaved={() => { closeAdd(); router.refresh(); }} />
            </FormModal>
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
                {tabsNode}
                <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
                    <div className="relative flex-1 xl:w-[260px]">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search parents…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowAdd(true)}
                        className="btn btn-secondary !h-8 !px-3 !text-xs shrink-0 whitespace-nowrap"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add Parent
                    </button>
                </div>
            </div>
            <GlassCard className="overflow-hidden !p-0">
                <div className="overflow-x-auto px-[15px] py-2.5">
                    <table className="data-table data-table-rich">
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
                                        <span className="cell-mono cell-muted">{parent.parentId}</span>
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-2.5">
                                            <EntityAvatar name={parent.parentName || '?'} />
                                            <span className="cell-strong">{parent.parentName}</span>
                                        </div>
                                    </td>
                                    <td>{parent.kidName}</td>
                                    <td>{parent.grade}</td>
                                    <td>
                                        <span className="block">{parent.mobile}</span>
                                        <span className="block cell-sub">{parent.email}</span>
                                    </td>
                                    <td>
                                        <StatusBadge status={parent.status as StatusType} />
                                    </td>
                                    <td className="num">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* We can add an edit page later: href={`/parents/edit/${parent.dbId}`} */}
                                            <Link href={'#'} className="icon-btn" title="Edit Parent">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Link>
                                            <button
                                                onClick={() => confirmDelete(parent)}
                                                className="icon-btn icon-btn-danger"
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
                                    <td colSpan={7} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="popup-panel animate-slide-up w-full max-w-sm overflow-hidden">
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
