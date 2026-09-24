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
        return 'bg-emerald-500/10 text-emerald-500';
      case 'Pending':
      case 'Pending Approval':
      case 'Awaiting Upload':
      case 'IN PROGRESS':
        return 'bg-amber-500/10 text-amber-500';
      case 'LOW DENSITY':
        return 'bg-sky-500/10 text-sky-500';
      case 'COMPLETED':
        return 'bg-indigo-500/10 text-indigo-500';
      case 'Revoked':
      case 'Unpaid':
      case 'Inactive':
        return 'bg-zinc-500/10 text-zinc-400';
      case 'Tampering':
      case 'SYNC WARNING':
        return 'bg-rose-500/10 text-rose-500 animate-pulse';
      default:
        return 'bg-zinc-500/10 text-zinc-400';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold ${getStyles()}`}>
      {status}
    </span>
  );
}
