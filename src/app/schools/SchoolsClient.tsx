'use client';

import React, { useState, useTransition } from 'react';
import { 
  School as SchoolIcon, 
  Plus, 
  ChevronRight,
  Edit2,
  Trash2,
  AlertTriangle,
  X
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';
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
}

export default function SchoolsClient({ initialSchools }: SchoolsClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [schools, setSchools] = useState<SchoolRow[]>(initialSchools);
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
    <div className="space-y-8 max-w-6xl mx-auto relative">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header Panel */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            Schools
          </h2>
        </div>

        <Link
          href="/schools/new"
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          ADD SCHOOL
        </Link>
      </div>

      {/* Directory Table Grid */}
      <GlassCard className="bg-[#121216]/40 border border-white/5 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                <th className="py-4 px-3.5">School Name</th>
                <th className="py-4 px-3.5">Board</th>
                <th className="py-4 px-3.5">Grade / Section</th>
                <th className="py-4 px-3.5">Full Class Name</th>
                <th className="py-4 px-3.5">Academic Year</th>
                <th className="py-4 px-3.5">Mediums</th>
                <th className="py-4 px-3.5">Devices</th>
                <th className="py-4 px-3.5">Status</th>
                <th className="py-4 px-3.5">Last Sync</th>
                <th className="py-4 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {schools.map(sch => {
                return (
                  <tr key={sch.dbId} className="hover:bg-white/[0.01] transition-colors group">
                    <td className="py-4 px-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <SchoolIcon className="w-4.5 h-4.5 text-zinc-400" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-white group-hover:text-accent-violet transition-colors">
                            {sch.name}
                          </h4>
                          <p className="text-[10px] text-zinc-500 font-medium uppercase mt-0.5">ID: {sch.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-3.5 text-sm font-bold text-zinc-300">{sch.board}</td>
                    <td className="py-4 px-3.5 text-xs text-zinc-400 font-semibold">{sch.standard} / {sch.section}</td>
                    <td className="py-4 px-3.5 text-xs text-zinc-400 font-medium">{sch.fullClassName}</td>
                    <td className="py-4 px-3.5 text-xs text-zinc-400 font-mono">{sch.academicYear}</td>
                    <td className="py-4 px-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sch.mediums.map((med: string) => (
                          <span key={med} className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/5 text-zinc-400 font-medium">
                            {med}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-3.5 text-sm font-bold text-zinc-300">
                      {sch.devicesUsed}
                    </td>
                    <td className="py-4 px-3.5">
                      <StatusBadge status={sch.status as any} />
                    </td>
                    <td className="py-4 px-3.5">
                      <div>
                        <p className="text-xs font-semibold text-zinc-300">{sch.lastSync}</p>
                        <p className="text-[9px] font-medium text-zinc-500 mt-0.5 tracking-wider">{sch.gateway}</p>
                      </div>
                    </td>
                    <td className="py-4 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link 
                          href={`/schools/edit/${sch.dbId}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-zinc-300 hover:border-accent-violet hover:text-white transition-all cursor-pointer"
                          title="Edit Details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                        
                        <button 
                          onClick={() => confirmDelete(sch)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-xs font-bold text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <GlassCard className="w-full max-w-md bg-[#121216] border border-white/10 p-6 space-y-6 shadow-2xl relative">
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
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-all cursor-pointer disabled:opacity-50"
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
