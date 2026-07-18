import React from 'react';

export type StatusType = 
  | 'Active' | 'Inactive' | 'OPERATIONAL' | 'SUCCESS' | 'Paid'
  | 'Pending' | 'Pending Approval' | 'Awaiting Upload' | 'LOW DENSITY' | 'IN PROGRESS'
  | 'Unpaid' | 'Revoked' | 'COMPLETED' | 'VERIFIED'
  | 'Tampering' | 'SYNC WARNING';

interface StatusBadgeProps {
  status: StatusType;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const getStyles = () => {
    switch (status) {
      case 'Active':
      case 'Paid':
      case 'OPERATIONAL':
      case 'SUCCESS':
      case 'VERIFIED':
        return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'Pending':
      case 'Pending Approval':
      case 'Awaiting Upload':
      case 'IN PROGRESS':
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case 'LOW DENSITY':
        return 'bg-sky-500/10 text-sky-400 border border-sky-500/20';
      case 'COMPLETED':
        return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
      case 'Revoked':
      case 'Unpaid':
      case 'Inactive':
        return 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20';
      case 'Tampering':
      case 'SYNC WARNING':
        return 'bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse';
      default:
        return 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${getStyles()}`}>
      {status}
    </span>
  );
}
