'use client';

import React, { useState, useTransition, useCallback } from 'react';
import { 
  Search,
  Plus,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ChevronRight,
  Edit2,
  Trash2,
  AlertTriangle,
  X
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import EntityAvatar from '@/components/EntityAvatar';
import StatusBadge from '@/components/StatusBadge';
import Link from '@/components/PanelLink';
import FormModal from '@/components/FormModal';
import NewSchoolForm from '@/components/forms/NewSchoolForm';
import { deleteSchoolAction } from './actions';
import { useToast } from '@/components/Toast';

interface SchoolRow {
  dbId: string;
  id: string;
  name: string;
  board: string;
  mediums: string[];
  devicesUsed: number;
  status: string;
  lastSync: string;
  gateway: string;
  academicYear: string;
  section: string;
  standard: string;
  fullClassName: string;
}

interface SchoolsClientProps {
  initialSchools: SchoolRow[];
  tabsNode?: React.ReactNode;
}

export default function SchoolsClient({ initialSchools, tabsNode }: SchoolsClientProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const [schools, setSchools] = useState<SchoolRow[]>(initialSchools);
  // Keep the list in step with fresh server data (router.refresh() after adding from the pop-up).
  const [prevInitial, setPrevInitial] = useState(initialSchools);
  if (initialSchools !== prevInitial) {
      setPrevInitial(initialSchools);
      setSchools(initialSchools);
  }
  const [showAdd, setShowAdd] = useState(false);
  const closeAdd = useCallback(() => setShowAdd(false), []);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [schoolToDelete, setSchoolToDelete] = useState<SchoolRow | null>(null);

  const confirmDelete = (sch: SchoolRow) => {
    setSchoolToDelete(sch);
    setShowConfirmModal(true);
  };

  const handleDelete = () => {
    if (!schoolToDelete) return;
    
    const targetId = schoolToDelete.dbId;
    const targetName = schoolToDelete.name;
    startTransition(async () => {
      const res = await deleteSchoolAction(targetId);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setSchools(prev => prev.filter(s => s.dbId !== targetId));
      toast(`School "${targetName}" and all payments/keys have been deleted successfully.`, 'success');
      setShowConfirmModal(false);
      setSchoolToDelete(null);
    });
  };

  return (
    <div className="space-y-4 relative">
        <FormModal open={showAdd} onClose={closeAdd}>
            <NewSchoolForm onClose={closeAdd} />
        </FormModal>
      {/* Directory Table */}
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
                {tabsNode}
                <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
                    <div className="relative flex-1 xl:w-[260px]">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search schools…"
                            className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowAdd(true)}
                        className="btn btn-secondary !h-8 !px-3 !text-xs shrink-0 whitespace-nowrap"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add School
                    </button>
                </div>
            </div>
      <GlassCard className="overflow-hidden !p-0">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich">
            <thead>
              <tr>
                <th>School Name</th>
                <th>Board</th>
                <th>Grade / Section</th>
                <th>Full Class Name</th>
                <th>Academic Year</th>
                <th>Mediums</th>
                <th className="num">Devices</th>
                <th>Status</th>
                <th>Last Sync</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schools.length === 0 && (
                <tr>
                  <td colSpan={10} className="!h-auto !whitespace-normal text-center !py-10 text-zinc-500">
                    No schools found.
                  </td>
                </tr>
              )}
              {schools.map(sch => {
                return (
                  <tr key={sch.dbId}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <EntityAvatar name={sch.name || '?'} size={32} />
                        <div>
                          <span className="block cell-strong">{sch.name}</span>
                          <span className="block cell-sub">ID: {sch.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="cell-strong">{sch.board}</td>
                    <td>{sch.standard} / {sch.section}</td>
                    <td>{sch.fullClassName}</td>
                    <td className="cell-num">{sch.academicYear}</td>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sch.mediums.map((med: string) => (
                          <span key={med} className="log-chip">
                            {med}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num font-semibold">{sch.devicesUsed}</td>
                    <td>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <StatusBadge status={sch.status as any} />
                    </td>
                    <td>
                      <span className="block">{sch.lastSync}</span>
                      <span className="block cell-sub">{sch.gateway}</span>
                    </td>
                    <td className="num">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/schools/edit/${sch.dbId}`}
                          className="icon-btn"
                          title="Edit Details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => confirmDelete(sch)}
                          className="icon-btn icon-btn-danger"
                          title="Delete School"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Confirmation Modal */}
      {showConfirmModal && schoolToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-md p-6 space-y-6 relative">
            <button 
              onClick={() => {
                setShowConfirmModal(false);
                setSchoolToDelete(null);
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
                <h3 className="text-lg font-bold text-white">Confirm Cascade Deletion</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Are you absolutely sure you want to delete <strong className="text-zinc-200">{schoolToDelete.name}</strong>?
                </p>
                <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-rose-400 font-semibold leading-relaxed">
                    ⚠️ CRITICAL NOTE: All associated payments, transaction records, and cryptographic key bindings will be permanently deleted from the collection.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setSchoolToDelete(null);
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
