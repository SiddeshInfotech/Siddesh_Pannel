'use client';

import React, { useState, useTransition } from 'react';
import { 
  Building2,
  Search,
  School as SchoolIcon, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Plus, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const [search, setSearch] = useState('');
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
    <div className="space-y-6 relative">
      {/* Directory Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="metric-icon">
              <Building2 className="w-4 h-4 text-foreground" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">Schools</h2>
              <p className="page-subtitle !mt-0.5">{schools.length} registered</p>
            </div>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schools..."
              className="field-input pl-9"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="ui-table">
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
              {schools.map(sch => {
                return (
                  <tr key={sch.dbId}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="metric-icon">
                          <SchoolIcon className="w-4 h-4 text-foreground" />
                        </span>
                        <div>
                          <span className="block font-semibold text-foreground">{sch.name}</span>
                          <span className="block text-[11px] text-zinc-500 mt-0.5">ID: {sch.id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="font-semibold">{sch.board}</td>
                    <td>{sch.standard} / {sch.section}</td>
                    <td>{sch.fullClassName}</td>
                    <td className="font-mono">{sch.academicYear}</td>
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
                      <span className="block font-medium">{sch.lastSync}</span>
                      <span className="block text-[11px] text-zinc-500 mt-0.5">{sch.gateway}</span>
                    </td>
                    <td className="num">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/schools/edit/${sch.dbId}`}
                          className="btn btn-secondary !h-8 !px-2.5"
                          title="Edit Details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => confirmDelete(sch)}
                          className="btn btn-secondary !h-8 !px-2.5 text-rose-500"
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
          <GlassCard className="w-full max-w-md border border-white/10 p-6 space-y-6 shadow-2xl relative">
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
