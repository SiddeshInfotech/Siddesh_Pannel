'use client';

import React, { useState, useTransition, useRef, useEffect } from 'react';
import { 
  Laptop, 
  Smartphone, 
  Tv, 
  Monitor, 
  Search, 
  AlertCircle,
  X,
  Shield,
  Info,
  Calendar,
  Hash,
  User,
  Mail,
  Phone,
  Layers,
  ChevronDown,
  Award,
  Clock,
  Key,
  BookOpen,
  Lock,
  CheckCircle2,
  FileCheck,
  FileX,
  ShieldAlert,
  Power,
  Ban,
  CirclePause,
  CircleDollarSign
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import GlassCard from '@/components/GlassCard';
import FormModal from '@/components/FormModal';
import EntityAvatar from '@/components/EntityAvatar';
import { deactivateDevice } from './actions';
import { useToast } from '@/components/Toast';
import { productFilterOptionsFor, UNRESOLVED_PRODUCT_FILTER_VALUE, isProductId, productDisplayName } from '@/lib/productIdentity';
import { tierStyle } from '@/lib/tierStyle';

// Status column renders as an icon; the tooltip carries the word.
const STATUS_ICON: Record<DeviceRow['status'], { Icon: React.ElementType; cls: string; label: string }> = {
  Active:   { Icon: CheckCircle2,     cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500', label: 'Active' },
  Paid:     { Icon: CircleDollarSign, cls: 'bg-sky-500/10 border-sky-500/25 text-sky-500',             label: 'Paid' },
  Unpaid:   { Icon: AlertCircle,      cls: 'bg-amber-500/10 border-amber-500/25 text-amber-500',       label: 'Unpaid' },
  Inactive: { Icon: CirclePause,      cls: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-400',          label: 'Inactive (expired)' },
  Revoked:  { Icon: Ban,              cls: 'bg-rose-500/10 border-rose-500/25 text-rose-500',          label: 'Deactivated' },
};

interface DeviceRow {
  id: string;
  model: string;
  os: string;
  fingerprint: string;
  board?: string;
  brand?: string;
  device?: string;
  manufacturer?: string;
  androidId?: string;
  activationDate: string;
  exactActivationDate: string;
  // Raw ISO twin of exactActivationDate/exactLastSync/termsAcceptedAt/expiryTamperAt
  // below — those are pre-formatted for display (toLocaleString) and cannot be
  // reliably re-parsed by `new Date(...)`. Used only for chronological sorting in the
  // device lifecycle timeline.
  activatedAtIso: string | null;
  lastSync: string;
  exactLastSync: string;
  lastSyncIso: string | null;
  remainingTime: string;
  status: 'Active' | 'Inactive' | 'Revoked' | 'Unpaid' | 'Paid';
  // Entity ownership (school | vendor | student). Drives the Schools/Vendors/Users filter.
  entityType: 'school' | 'vendor' | 'student';
  entityName: string;
  // Vendor detail (admin-only view).
  vendorId: string;
  vendorCode: string;
  vendorCategory: string;
  vendorCity: string;
  vendorState: string;
  vendorEmail: string;
  vendorPhone: string;
  vendorYear: string;
  // Student / parent detail (admin-only view).
  studentName: string;
  studentGrade: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  parentCity: string;
  parentState: string;
  schoolName: string;
  schoolCustomId: string;
  schoolBoard: string;
  schoolMediums: string;
  schoolStandard: string;
  schoolSection: string;
  schoolClassName: string;
  schoolAcademicYear: string;
  schoolCoordinator: string;
  schoolEmail: string;
  schoolPhone: string;
  licenseKey: string;
  durationDays: number;
  expiresAt?: string | null;
  securityTier: string;
  // 'managed_panel' when the key was generated as Interactive panel (src/lib/deviceClass.ts).
  deviceClass: string | null;
  // Server-derived, trusted tier (attestationPolicy.deriveServerTier) — the primary
  // security indicator; securityTier above is the device's own untrusted self-report.
  verifiedTier: string;
  // Most recent GENUINE attestation problem for this device (never the routine
  // no-hardware case) — null when none is on record.
  attestationIssue: {
    tier: string;
    reasonCode: string;
    reasonDetail: string;
    count: number;
    enforced: boolean;
    action: string;
    at: string;
  } | null;
  // Canonical product_id (src/lib/productIdentity.ts) when the device reported one, else
  // the auto-detected product (src/lib/product.ts) for older rows/clients; null if neither
  // resolved.
  product: string | null;
  termsAccepted: boolean;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  termsAcceptedAtIso: string | null;
  // Server-side expiry-tamper: flagged when the device reported an expiry later than signed.
  expiryTamper: boolean;
  expiryTamperAt: string | null;
  expiryTamperAtIso: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expiryTamperDetail: any;
}

// Maps the SERVER-DERIVED verified tier (attestationPolicy.ServerAttestationTier) to a
// short label + badge colour. This is the trusted value — unlike tierStyle() above,
// which colours the device's own unverified self-report. Kept visually distinct so an
// operator never mistakes a green "reported" badge for genuine hardware proof.
function verifiedTierStyle(tier: string): { label: string; cls: string } {
  switch (tier) {
    case 'VERIFIED_STRONGBOX':
      return { label: 'Verified · StrongBox', cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' };
    case 'VERIFIED_TEE':
      return { label: 'Verified · TEE', cls: 'bg-green-500/10 border-green-500/25 text-green-400' };
    case 'VERIFIED_PLATFORM_CLAIM':
      return { label: 'Verified · Platform claim', cls: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400' };
    case 'VERIFIED_UNSPECIFIED_HW':
      return { label: 'Verified · Unspecified HW', cls: 'bg-sky-500/10 border-sky-500/25 text-sky-400' };
    case 'UNSUPPORTED':
      return { label: 'Unsupported (no HW)', cls: 'bg-white/5 border-white/10 text-zinc-400' };
    case 'INVALID':
      return { label: 'Invalid evidence', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-400' };
    case 'REVOKED':
      return { label: 'Revoked cert', cls: 'bg-red-600/10 border-red-600/30 text-red-400' };
    case 'REPLAY_OR_SKEW':
      return { label: 'Replay / clock skew', cls: 'bg-orange-500/10 border-orange-500/25 text-orange-400' };
    case 'TEMPORARY_ERROR':
      return { label: 'Temporary error', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400' };
    // Interactive-panel key: licence-authorized + bound to one device key (rolling proof of
    // possession). Deliberately NOT styled or worded as hardware verification.
    case 'MANAGED_PANEL_BOUND':
      return { label: 'Enrolled panel · not HW-attested', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-300' };
    default:
      return { label: 'Not verified yet', cls: 'bg-white/5 border-white/10 text-zinc-400' };
  }
}

// Bounded reason-code → admin-facing label (attestationTelemetry.AttestationReasonCode).
// Keying off the ENUM rather than the raw verifier string is deliberate: the raw string
// is diagnostic-only and not guaranteed to stay a small fixed set forever, so the UI's
// primary label must never depend on it. UNKNOWN (or any future code not yet added
// here) falls back to a generic label — never hides that *something* was flagged.
function attestationReasonLabel(reasonCode: string): string {
  const KNOWN: Record<string, string> = {
    CHAIN_MISSING: 'No chain sent',
    CHAIN_INVALID: 'Broken chain',
    ROOT_UNTRUSTED: 'Untrusted root',
    PUBKEY_MISSING: 'No wrap key sent',
    PUBKEY_MISMATCH: 'Key mismatch',
    CHALLENGE_MISMATCH: 'Challenge mismatch',
    SECURITY_LEVEL_INVALID: 'Not hardware-backed',
    ORIGIN_INVALID: 'Untrusted key origin',
    EXTENSION_UNPARSEABLE: 'Unparseable evidence',
    CLAIM_MISSING: 'Claimed TPM, sent none',
    SIGNATURE_INVALID: 'Bad signature',
    CERT_REVOKED: 'Revoked cert',
    NONCE_REPLAY: 'Replayed request',
    CLOCK_SKEW: 'Clock skew',
    SERVER_MISCONFIGURED: 'Server misconfigured',
  };
  return KNOWN[reasonCode] ?? 'Attestation problem';
}

// This column has carried TWO different naming schemes over time: the current canonical
// UPPERCASE ProductId (src/lib/productIdentity.ts, e.g. LMS_SCHOOL_WINDOWS — written by
// every route today) and the older lowercase auto-detected scheme production-ready-1Sep26
// briefly wrote (src/lib/product.ts's now-superseded Product type, e.g. lms_windows) that
// historical rows may still carry. A plain case-fold does NOT unify them: the legacy scheme
// named the School family bare (lms_android/lms_windows/lms_linux, no "school"), while the
// canonical one is explicit (LMS_SCHOOL_ANDROID/LMS_SCHOOL_WINDOWS) and doesn't include a
// School-Linux product at all. Map the legacy names explicitly so old rows still render a
// real badge instead of silently falling to "Unknown".
const LEGACY_PRODUCT_ALIASES: Record<string, string> = {
  lms_lab_android: 'LMS_LAB_ANDROID',
  lms_lab_windows: 'LMS_LAB_WINDOWS',
  lms_lab_linux: 'LMS_LAB_LINUX',
  lms_android: 'LMS_SCHOOL_ANDROID',
  lms_windows: 'LMS_SCHOOL_WINDOWS',
  lms_linux: 'LMS_SCHOOL_LINUX', // legacy-only: canonical ProductId has no School-Linux product
};

// Maps the resolved product (either naming scheme above — see the `product` field comment)
// to a short label + badge colour. LMS Lab family in cool tones, LMS School/original apps in
// warmer ones; null/unresolved neutral.
function productStyle(product: string | null): { label: string; cls: string } {
  const key = product ? (LEGACY_PRODUCT_ALIASES[product.toLowerCase()] ?? product.toUpperCase()) : null;
  switch (key) {
    case 'LMS_LAB_ANDROID':
      return { label: 'LMS Lab · Android', cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' };
    case 'LMS_LAB_WINDOWS':
      return { label: 'LMS Lab · Windows', cls: 'bg-sky-500/10 border-sky-500/25 text-sky-400' };
    case 'LMS_LAB_LINUX':
      return { label: 'LMS Lab · Linux', cls: 'bg-violet-500/10 border-violet-500/25 text-violet-400' };
    case 'LMS_SCHOOL_ANDROID':
      return { label: 'LMS School · Android', cls: 'bg-teal-500/10 border-teal-500/25 text-teal-400' };
    case 'LMS_SCHOOL_WINDOWS':
      return { label: 'LMS School · Windows', cls: 'bg-blue-500/10 border-blue-500/25 text-blue-400' };
    case 'LMS_SCHOOL_LINUX':
      return { label: 'LMS School · Linux', cls: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-400' };
    default:
      // The 4 booklet Lab products (LAB_STEM_ANDROID, …): label from the canonical registry.
      if (key && isProductId(key)) {
        return { label: productDisplayName(key), cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' };
      }
      return { label: 'Unknown', cls: 'bg-white/5 border-white/10 text-zinc-400' };
  }
}

/** Table column: product family + platform — "School · Android", "Lab · Windows" (full name in the tooltip). */
function productFamily(product: string | null): string {
  const key = product ? (LEGACY_PRODUCT_ALIASES[product.toLowerCase()] ?? product.toUpperCase()) : '';
  const family = key.includes('SCHOOL') ? 'School' : key.includes('LAB') ? 'Lab' : null;
  if (!family) return 'Unknown';
  const platform = key.endsWith('_ANDROID') ? 'Android' : key.endsWith('_WINDOWS') ? 'Windows' : key.endsWith('_LINUX') ? 'Linux' : null;
  return platform ? `${family} · ${platform}` : family;
}

interface MonitoringClientProps {
  initialDevices: DeviceRow[];
  totalDevicesCount: number;
  panel: 'lms' | 'lab';
}

// Rows per page in the device table. Each row is wide and detail-heavy, so a page of 10
// fills the viewport without forcing an endless scroll on a large fleet.
const DEVICES_PER_PAGE = 10;

export default function MonitoringClient({ initialDevices, totalDevicesCount, panel }: MonitoringClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<'All' | 'Schools' | 'Vendors' | 'Users'>('All');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [isProductMenuOpen, setIsProductMenuOpen] = useState(false);
  const productMenuRef = useRef<HTMLDivElement>(null);

  // Close custom dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (productMenuRef.current && !productMenuRef.current.contains(event.target as Node)) {
        setIsProductMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [selectedDevice, setSelectedDevice] = useState<DeviceRow | null>(null);
  const [page, setPage] = useState(1);
  const [devicesList, setDevicesList] = useState<DeviceRow[]>(initialDevices);

  // Dynamic ticking countdown for remaining time in real time
  React.useEffect(() => {
    const calculateTimeRemaining = (expiresAt: string | null | undefined, status: string) => {
      if (status === 'Revoked') return 'Deactivated';
      if (!expiresAt) return 'N/A';
      const diffTime = new Date(expiresAt).getTime() - new Date().getTime();
      if (diffTime <= 0) return 'Expired';

      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const diffMins = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
      const diffSecs = Math.floor((diffTime % (1000 * 60)) / 1000);

      if (diffDays > 0) {
        return `${diffDays}d ${diffHours}h left`;
      } else if (diffHours > 0) {
        return `${diffHours}h ${diffMins}m left`;
      } else if (diffMins > 0) {
        return `${diffMins}m ${diffSecs}s left`;
      } else {
        return `${diffSecs}s left`;
      }
    };

    const interval = setInterval(() => {
      setDevicesList(prev => prev.map(dev => {
        const newRemaining = calculateTimeRemaining(dev.expiresAt, dev.status);
        let newStatus = dev.status;
        if (newRemaining === 'Expired' && dev.status === 'Active') {
          newStatus = 'Inactive';
        }
        return { ...dev, remainingTime: newRemaining, status: newStatus };
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);
  
  // Custom deactivation modal states
  const [deactivatingDeviceId, setDeactivatingDeviceId] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<'none' | 'confirm' | 'password'>('none');
  const [deactivationPassword, setDeactivationPassword] = useState('');

  const handleDeactivate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Avoid selecting row when clicking deactivate button
    setDeactivatingDeviceId(id);
    setConfirmStep('confirm');
    toast('Warning: Deactivating this device binding will instantly disconnect the node and revoke license access.', 'info');
  };

  const handlePasswordSubmit = () => {
    // No client-side password check: the admin's real password is verified
    // SERVER-SIDE in deactivateDevice (step-up re-auth). The browser never holds
    // or compares a secret.
    if (!deactivatingDeviceId || !deactivationPassword) return;

    const deviceId = deactivatingDeviceId;
    startTransition(async () => {
      const res = await deactivateDevice(deviceId, deactivationPassword);
      if (!res.ok) {
        // res.error is already a safe, generic message (no internal detail).
        toast(res.error, 'error');
        setDeactivationPassword('');
        return;
      }
      toast('Device successfully deactivated.', 'success');
      setDevicesList(prev => prev.map(d => d.id === deviceId ? { ...d, status: 'Revoked', remainingTime: 'Deactivated' } : d));
      if (selectedDevice && selectedDevice.id === deviceId) {
        setSelectedDevice(prev => prev ? { ...prev, status: 'Revoked', remainingTime: 'Deactivated' } : null);
      }
      setConfirmStep('none');
      setDeactivatingDeviceId(null);
      setDeactivationPassword('');
    });
  };

  const getDeviceIcon = (model: string, os: string) => {
    const combined = `${model} ${os}`.toLowerCase();
    if (combined.includes('mac') || combined.includes('book') || combined.includes('laptop')) return Laptop;
    if (combined.includes('ipad') || combined.includes('phone') || combined.includes('android') || combined.includes('sdk')) return Smartphone;
    if (combined.includes('surface') || combined.includes('tv')) return Tv;
    return Monitor;
  };

  // Schools → school devices, Vendors → vendor devices, Users → student/parent devices.
  const filteredDevices = devicesList.filter(dev => {
    // Older device rows (activated before entityType existed) default to 'school'.
    if (entityFilter !== 'All') {
      const entityFilterType = entityFilter === 'Vendors' ? 'vendor' : entityFilter === 'Users' ? 'student' : 'school';
      if ((dev.entityType || 'school') !== entityFilterType) return false;
    }
    if (productFilter === UNRESOLVED_PRODUCT_FILTER_VALUE) {
      if (dev.product) return false;
    } else if (productFilter !== 'all' && dev.product !== productFilter) {
      return false;
    }
    const q = search.toLowerCase();
    return dev.model.toLowerCase().includes(q) ||
      dev.fingerprint.toLowerCase().includes(q) ||
      (dev.entityName || dev.schoolName).toLowerCase().includes(q);
  });

  // Pagination — a fleet of a few thousand tablets makes an unbounded table both slow to
  // render and impossible to navigate. Clamped so an active page can never point past the
  // end after a filter narrows the result set.
  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / DEVICES_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * DEVICES_PER_PAGE;
  const pagedDevices = filteredDevices.slice(pageStart, pageStart + DEVICES_PER_PAGE);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header & Filters — Payments style */}
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-2xl font-bold text-foreground">Device Monitoring</h2>
          <div className="flex items-center gap-2">
            <span className="stat-chip"><Monitor className="w-3.5 h-3.5 text-accent-violet" /> Total devices <span className="stat-chip-value">{totalDevicesCount}</span></span>
            <span className="stat-chip"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Active <span className="stat-chip-value">{devicesList.filter(d => d.status === 'Active').length}</span></span>
            <span className="stat-chip"><Search className="w-3.5 h-3.5" /> Shown <span className="stat-chip-value">{filteredDevices.length}</span></span>
          </div>
        </div>

        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border mt-2">
          <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
            {(['All', 'Schools', 'Vendors', 'Users'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { setEntityFilter(t); setPage(1); }}
                className={`filter-tab ${entityFilter === t ? 'filter-tab-active' : ''}`}
              >
                {t}
              </button>
            ))}

            <div ref={productMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductMenuOpen(!isProductMenuOpen)}
                className={`filter-tab ${productFilter !== 'all' ? 'filter-tab-active' : ''}`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {productFilter === 'all'
                    ? 'Product Types'
                    : productFilterOptionsFor(panel).find(o => o.value === productFilter)?.label || 'Product Types'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${isProductMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isProductMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-52 z-50 animate-fade-in">
                  <div className="menu-panel">
                    {productFilterOptionsFor(panel).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { setProductFilter(opt.value); setPage(1); setIsProductMenuOpen(false); }}
                        className={`menu-item ${productFilter === opt.value ? 'menu-item-active' : ''}`}
                      >
                        {opt.label === 'All Products' ? 'All Product Types' : opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative w-full xl:w-[260px] mb-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by fingerprint, model, entity…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Main Table list */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich min-w-[1040px]">
            <thead>
              <tr className="border-b border-sidebar-border h-[44px]">
                <th>Device</th>
                <th>Fingerprint</th>
                <th>{entityFilter === 'Vendors' ? 'Vendor Name' : entityFilter === 'Users' ? 'Student Name' : entityFilter === 'All' ? 'Entity Name' : 'School Name'}</th>
                <th>Security Tier</th>
                <th>Product</th>
                <th className="text-center">Consent</th>
                <th>Activation</th>
                <th>Remaining</th>
                <th className="text-center">Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedDevices.length > 0 ? (
                pagedDevices.map(dev => {
                  return (
                    <tr 
                      key={dev.id} 
                      onClick={() => setSelectedDevice(dev)}
                      className="group cursor-pointer"
                    >
                      <td>
                        <div className="flex items-center gap-2" title={dev.os}>
                          <span className="cell-strong">{dev.model}</span>
                          {dev.deviceClass === 'managed_panel' && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-black text-[8px] font-bold uppercase tracking-wide">
                              Interactive panel
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="cell-mono cell-muted" title={dev.fingerprint}>
                          {dev.fingerprint.substring(0, 12)}…
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <EntityAvatar name={dev.entityName || dev.schoolName || '?'} />
                          <span>{dev.entityName || dev.schoolName}</span>
                          {dev.expiryTamper && (
                            <span
                              title={`Expiry tamper detected${dev.expiryTamperAt ? ` on ${dev.expiryTamperAt}` : ''}${dev.expiryTamperDetail?.extra_days ? ` (+${dev.expiryTamperDetail.extra_days}d claimed)` : ''}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap bg-rose-500/10 border-rose-500/30 text-rose-400"
                            >
                              <ShieldAlert className="w-3 h-3" /> Tamper
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {(() => {
                            const v = verifiedTierStyle(dev.verifiedTier);
                            return (
                              <span
                                title={`Server-verified tier (trusted): ${dev.verifiedTier}`}
                                className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${v.cls}`}
                              >
                                {v.label}
                              </span>
                            );
                          })()}
                          {dev.attestationIssue && (
                            <span
                              title={`Attestation issue (${dev.attestationIssue.action}) ×${dev.attestationIssue.count}: ${attestationReasonLabel(dev.attestationIssue.reasonCode)} — ${dev.attestationIssue.reasonDetail}`}
                              aria-label="Attestation issue"
                              className="inline-flex items-center justify-center w-5 h-5 rounded-md border bg-rose-500/10 border-rose-500/30 text-rose-500"
                            >
                              <ShieldAlert className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <div className="cell-sub" title={`Device-reported tier (untrusted self-report): ${dev.securityTier}`}>
                          Reported: {tierStyle(dev.securityTier).label}
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const p = productStyle(dev.product);
                          return (
                            <span
                              title={p.label}
                              className="cell-muted"
                            >
                              {productFamily(dev.product)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="text-center">
                        {dev.termsAccepted ? (
                          <span
                            title={`Privacy Policy + Terms accepted${dev.termsVersion ? ` (v${dev.termsVersion})` : ''}${dev.termsAcceptedAt ? ` on ${dev.termsAcceptedAt}` : ''}`}
                            aria-label="Consent accepted"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg border bg-emerald-500/10 border-emerald-500/25 text-emerald-500"
                          >
                            <FileCheck className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span
                            title="No pre-activation consent recorded for this device"
                            aria-label="Consent not recorded"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg border bg-zinc-500/10 border-zinc-500/25 text-zinc-400"
                          >
                            <FileX className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </td>
                      <td className="cell-muted cell-num">{dev.activationDate}</td>
                      <td>
                        {(() => {
                          const ended = dev.remainingTime === 'Expired' || dev.remainingTime === 'Deactivated';
                          return (
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold tabular-nums ${
                              ended ? 'bg-rose-500/10 border-rose-500/25 text-rose-500' : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600'
                            }`}>
                              <Clock className="w-3 h-3" /> {dev.remainingTime}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="text-center">
                        {(() => {
                          const st = STATUS_ICON[dev.status] ?? STATUS_ICON.Inactive;
                          return (
                            <span title={st.label} aria-label={st.label} className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border ${st.cls}`}>
                              <st.Icon className="w-3.5 h-3.5" />
                            </span>
                          );
                        })()}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={(e) => handleDeactivate(e, dev.id)}
                          disabled={isPending || dev.status === 'Revoked'}
                          title={dev.status === 'Revoked' ? 'Already deactivated' : 'Deactivate device license'}
                          aria-label={dev.status === 'Revoked' ? 'Already deactivated' : 'Deactivate device license'}
                          className="icon-btn icon-btn-danger"
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="!h-auto !whitespace-normal py-12 text-center text-zinc-500 text-sm">
                    {/* colSpan spans all columns incl. the Security Tier + Consent columns */}
                    <AlertCircle className="w-5 h-5 mx-auto mb-2 text-zinc-600" />
                    No registered devices matching search filters found in the database.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — always shown alongside real rows (even a single page), so the
            control is visibly present rather than appearing only once a fleet grows past
            one page. Hidden only for the genuinely-empty result set, which already has
            its own "no devices" message above. */}
        {filteredDevices.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-white/5 bg-white/[0.02]">
            <span className="text-[11px] font-bold text-zinc-400">
              Showing <span className="text-zinc-200">{pageStart + 1}–{Math.min(pageStart + DEVICES_PER_PAGE, filteredDevices.length)}</span> of{' '}
              <span className="text-zinc-200">{filteredDevices.length}</span> devices
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>

              {/* A sliding window of page numbers — a fleet with 80 pages must not render
                  80 buttons. Always shows the current page with its neighbours. */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .map((p, idx, arr) => (
                  <React.Fragment key={p}>
                    {idx > 0 && p - arr[idx - 1] > 1 && (
                      <span className="px-1 text-[11px] font-bold text-zinc-600">…</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setPage(p)}
                      className={`min-w-[32px] px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        p === currentPage
                          ? 'bg-accent-violet text-white shadow-md'
                          : 'bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                ))}

              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-bold text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Modern Premium Glassmorphic Modal overlay */}
      {selectedDevice && (
        <FormModal
          open
          // Esc / backdrop must not close the details underneath an open deactivation prompt.
          onClose={() => { if (confirmStep === 'none') setSelectedDevice(null); }}
          panelClassName="glass relative w-full max-w-3xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden animate-slide-up"
        >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-sidebar-border">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 shrink-0 rounded-[10px] flex items-center justify-center bg-accent-violet/10 border border-accent-violet/20">
                  {React.createElement(getDeviceIcon(selectedDevice.model, selectedDevice.os), {
                    className: 'w-5 h-5 text-accent-violet'
                  })}
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
                    <span className="truncate">{selectedDevice.model}</span>
                    <StatusBadge status={selectedDevice.status} />
                  </h3>
                  <p className="text-xs text-zinc-500 font-medium">{selectedDevice.os} &bull; Handshake verification details</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDevice(null)}
                className="icon-btn shrink-0"
                aria-label="Close"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content - Scrollable */}
            <div className="px-6 py-5 overflow-y-auto space-y-6">
              {/* Expiry-tamper alert — server detected this device reporting an expiry later than signed. */}
              {selectedDevice.expiryTamper && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30">
                  <ShieldAlert className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <div className="text-rose-300 font-bold text-sm">Expiry tamper detected</div>
                    <div className="text-rose-200/80 mt-0.5">
                      This device reported an expiry LATER than the panel signed at activation
                      {selectedDevice.expiryTamperDetail?.extra_days ? ` (claimed +${selectedDevice.expiryTamperDetail.extra_days} days)` : ''}
                      {selectedDevice.expiryTamperAt ? ` · first seen ${selectedDevice.expiryTamperAt}` : ''}.
                    </div>
                    {selectedDevice.expiryTamperDetail?.reported_expiry && (
                      <code className="block text-[10px] text-rose-200/70 font-mono mt-1">
                        reported {String(selectedDevice.expiryTamperDetail.reported_expiry)} vs signed {String(selectedDevice.expiryTamperDetail.signed_expires_at ?? '—')}
                      </code>
                    )}
                  </div>
                </div>
              )}
              {/* 1. Device Hardware Properties */}
              <div>
                <h4 className="text-xs font-extrabold uppercase text-accent-violet tracking-wider mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Device Identity & Specs
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Hardware Fingerprint
                    </span>
                    <code className="text-xs text-zinc-300 font-mono block break-all pt-1 select-all">
                      {selectedDevice.fingerprint}
                    </code>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Android ID
                    </span>
                    <code className="text-xs text-zinc-300 font-mono block pt-1 select-all">
                      {selectedDevice.androidId || 'N/A'}
                    </code>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-0.5">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold">Board (Hardware)</span>
                    <span className="text-xs font-semibold text-zinc-300 block">{selectedDevice.board || 'N/A'}</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-0.5">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold">Brand</span>
                    <span className="text-xs font-semibold text-zinc-300 block">{selectedDevice.brand || 'N/A'}</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-0.5">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold">Device</span>
                    <span className="text-xs font-semibold text-zinc-300 block">{selectedDevice.device || 'N/A'}</span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/5 space-y-0.5">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold">Manufacturer</span>
                    <span className="text-xs font-semibold text-zinc-300 block">{selectedDevice.manufacturer || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* 2. Handshake Payload & Activation Status */}
              <div>
                <h4 className="text-xs font-extrabold uppercase text-accent-violet tracking-wider mb-3 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Cryptographic Handshake & Key Info
                </h4>
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 text-sm">
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold">Active License Key</span>
                      <code className="text-accent-violet font-semibold font-mono text-xs select-all">{selectedDevice.licenseKey}</code>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold">Validity Duration</span>
                      <span className="text-zinc-300 font-medium">{selectedDevice.durationDays} Days</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <Calendar className="w-3 h-3 text-zinc-500" /> Activation Time
                      </span>
                      <span className="text-zinc-300 font-medium text-xs">{selectedDevice.exactActivationDate}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-zinc-500" /> Last Monotonic Sync
                      </span>
                      <span className="text-zinc-300 font-medium text-xs">{selectedDevice.exactLastSync}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-zinc-500" /> Time Remaining
                      </span>
                      <span className="text-zinc-300 font-medium font-mono text-xs">{selectedDevice.remainingTime}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <Shield className="w-3 h-3 text-zinc-500" /> Server Verified (trusted)
                      </span>
                      {(() => {
                        const v = verifiedTierStyle(selectedDevice.verifiedTier);
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 ${v.cls}`}>
                            {v.label}
                          </span>
                        );
                      })()}
                      <code className="block text-[10px] text-zinc-500 font-mono mt-1">{selectedDevice.verifiedTier}</code>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-2">
                        <Shield className="w-3 h-3 text-zinc-600" /> Device Reported (untrusted)
                      </span>
                      {(() => {
                        const t = tierStyle(selectedDevice.securityTier);
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 opacity-70 ${t.cls}`}>
                            {t.label}
                          </span>
                        );
                      })()}
                      <code className="block text-[10px] text-zinc-500 font-mono mt-1">{selectedDevice.securityTier}</code>
                      {selectedDevice.attestationIssue && (
                        <div className="mt-2 p-2 rounded-lg border border-rose-500/25 bg-rose-500/5">
                          <span className="block text-[10px] text-rose-400 uppercase font-bold flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" /> Attestation Issue
                            {selectedDevice.attestationIssue.count > 1 && ` (×${selectedDevice.attestationIssue.count})`}
                          </span>
                          <span className="block text-xs text-rose-200/90 mt-1">
                            {attestationReasonLabel(selectedDevice.attestationIssue.reasonCode)}
                          </span>
                          <code className="block text-[9px] text-zinc-500 font-mono mt-1 break-all">
                            {selectedDevice.attestationIssue.reasonDetail}
                          </code>
                          <span className="block text-[10px] text-zinc-500 mt-1">
                            {selectedDevice.attestationIssue.enforced ? 'Rejected (401)' : 'Allowed, audit-only'} · last seen{' '}
                            {new Date(selectedDevice.attestationIssue.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}
                          </span>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <Laptop className="w-3 h-3 text-zinc-500" /> Product
                      </span>
                      {(() => {
                        const p = productStyle(selectedDevice.product);
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 ${p.cls}`}>
                            {p.label}
                          </span>
                        );
                      })()}
                      <code className="block text-[10px] text-zinc-500 font-mono mt-1">{selectedDevice.product}</code>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold flex items-center gap-1 mt-1">
                        <FileCheck className="w-3 h-3 text-zinc-500" /> Terms &amp; Privacy Consent
                      </span>
                      {selectedDevice.termsAccepted ? (
                        <>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 bg-emerald-500/10 border-emerald-500/25 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" /> Accepted
                            {selectedDevice.termsVersion ? ` · v${selectedDevice.termsVersion}` : ''}
                          </span>
                          {selectedDevice.termsAcceptedAt && (
                            <code className="block text-[10px] text-zinc-500 font-mono mt-1">{selectedDevice.termsAcceptedAt}</code>
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 bg-zinc-500/10 border-zinc-500/25 text-zinc-400">
                          Not recorded
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2b. Device lifecycle timeline — a device can carry a red attestation
                  badge AND be perfectly active, because the rejection happened BEFORE the
                  successful activation. Two isolated badges can't express that ordering;
                  a single chronological line can. Built from what's already on the row,
                  ordered oldest → newest. */}
              {(() => {
                type Ev = { at: Date | null; kind: 'ok' | 'warn' | 'error'; title: string; detail?: string; meta?: string };
                const parse = (v?: string | null): Date | null => {
                  if (!v) return null;
                  const d = new Date(v);
                  return isNaN(d.getTime()) ? null : d;
                };
                const events: Ev[] = [];
                if (selectedDevice.termsAccepted) {
                  events.push({
                    at: parse(selectedDevice.termsAcceptedAtIso),
                    kind: 'ok',
                    title: 'Terms & privacy accepted',
                    detail: selectedDevice.termsVersion ? `Consent v${selectedDevice.termsVersion} recorded` : 'Consent recorded',
                  });
                }
                if (selectedDevice.attestationIssue) {
                  const ai = selectedDevice.attestationIssue;
                  events.push({
                    at: parse(ai.at),
                    kind: ai.enforced ? 'error' : 'warn',
                    title: attestationReasonLabel(ai.reasonCode),
                    detail: ai.reasonDetail,
                    meta: `${ai.enforced ? 'Rejected (401)' : 'Allowed · audit-only'}${ai.count > 1 ? ` · ${ai.count} occurrences` : ''}`,
                  });
                }
                if (selectedDevice.expiryTamper) {
                  events.push({
                    at: parse(selectedDevice.expiryTamperAtIso),
                    kind: 'error',
                    title: 'Expiry tamper detected',
                    detail: 'Device reported an expiry later than the signed licence.',
                  });
                }
                events.push({
                  at: parse(selectedDevice.activatedAtIso),
                  kind: 'ok',
                  title: 'Licence activated',
                  detail: `Bound to this hardware for ${selectedDevice.durationDays} days`,
                });
                events.push({
                  at: parse(selectedDevice.lastSyncIso),
                  kind: 'ok',
                  title: 'Last monotonic sync',
                  detail: selectedDevice.remainingTime ? `${selectedDevice.remainingTime} remaining` : undefined,
                });

                const ordered = events.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
                const dot = {
                  ok: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
                  warn: 'bg-amber-500/15 border-amber-500/40 text-amber-400',
                  error: 'bg-rose-500/15 border-rose-500/40 text-rose-400',
                };

                return (
                  <div>
                    <h4 className="text-xs font-extrabold uppercase text-accent-violet tracking-wider mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Device Lifecycle
                    </h4>
                    <div className="relative pl-6">
                      {/* One continuous rail behind every node */}
                      <span className="absolute left-[9px] top-1 bottom-1 w-px bg-white/10" aria-hidden="true" />
                      <ol className="space-y-4">
                        {ordered.map((e, i) => (
                          <li key={`${e.title}-${i}`} className="relative">
                            <span
                              className={`absolute -left-6 top-0.5 w-[19px] h-[19px] rounded-full border flex items-center justify-center ${dot[e.kind]}`}
                              aria-hidden="true"
                            >
                              {e.kind === 'ok'
                                ? <CheckCircle2 className="w-3 h-3" />
                                : <ShieldAlert className="w-3 h-3" />}
                            </span>
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className={`text-xs font-bold ${
                                e.kind === 'error' ? 'text-rose-400' : e.kind === 'warn' ? 'text-amber-400' : 'text-zinc-200'
                              }`}>
                                {e.title}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {e.at ? e.at.toLocaleString('en-IN') : 'Time not recorded'}
                              </span>
                            </div>
                            {e.detail && (
                              <p className="text-[11px] text-zinc-400 mt-0.5 break-words">{e.detail}</p>
                            )}
                            {e.meta && (
                              <code className="inline-block text-[10px] font-mono text-zinc-500 mt-1">{e.meta}</code>
                            )}
                          </li>
                        ))}
                        {/* Terminal node: where the device stands right now */}
                        <li className="relative">
                          <span
                            className={`absolute -left-6 top-0.5 w-[19px] h-[19px] rounded-full border flex items-center justify-center ${
                              selectedDevice.status === 'Active' ? dot.ok : 'bg-white/5 border-white/15 text-zinc-400'
                            }`}
                            aria-hidden="true"
                          >
                            <Shield className="w-3 h-3" />
                          </span>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-xs font-bold text-zinc-200">Current state</span>
                            <StatusBadge status={selectedDevice.status} />
                          </div>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            {selectedDevice.attestationIssue && selectedDevice.status === 'Active'
                              ? 'The attestation rejection above predates this activation — the licence is live and the earlier failures are historical.'
                              : 'Live status as recorded by the panel.'}
                          </p>
                        </li>
                      </ol>
                    </div>
                  </div>
                );
              })()}

              {/* 3. Entity Profile Binding (School / Vendor / Student) */}
              <div>
                <h4 className="text-xs font-extrabold uppercase text-accent-violet tracking-wider mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  {selectedDevice.entityType === 'vendor' ? 'Vendor Information Binding'
                    : selectedDevice.entityType === 'student' ? 'Student Information Binding'
                    : 'School Information Binding'}
                </h4>

                {/* VENDOR */}
                {selectedDevice.entityType === 'vendor' ? (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                    <div className="flex justify-between items-start border-b border-white/5 pb-3 flex-wrap gap-2">
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Vendor ID</span>
                        <code className="block text-xs text-zinc-400 font-mono font-semibold">{selectedDevice.vendorId}</code>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Vendor Name</span>
                        <span className="block text-sm text-white font-bold">{selectedDevice.entityName}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6 text-xs">
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Vendor Code</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.vendorCode}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Category</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.vendorCategory}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Year</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.vendorYear}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Location</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.vendorCity}, {selectedDevice.vendorState}</span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Mail className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Email:</b> {selectedDevice.vendorEmail}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Phone className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Phone:</b> {selectedDevice.vendorPhone}</span>
                      </div>
                    </div>
                  </div>
                ) : selectedDevice.entityType === 'student' ? (
                  /* STUDENT / PARENT */
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                    <div className="flex justify-between items-start border-b border-white/5 pb-3 flex-wrap gap-2">
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Student Name</span>
                        <span className="block text-sm text-white font-bold">{selectedDevice.studentName}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Grade</span>
                        <span className="block text-sm text-white font-bold">{selectedDevice.studentGrade}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 text-xs">
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Parent / Guardian</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.parentName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Location</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.parentCity}, {selectedDevice.parentState}</span>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Mail className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Email:</b> {selectedDevice.parentEmail}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Phone className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Phone:</b> {selectedDevice.parentPhone}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* SCHOOL (unchanged) */
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-4">
                    <div className="flex justify-between items-start border-b border-white/5 pb-3 flex-wrap gap-2">
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Bound School ID</span>
                        <code className="block text-xs text-zinc-400 font-mono font-semibold">{selectedDevice.schoolCustomId}</code>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">School Name</span>
                        <span className="block text-sm text-white font-bold">{selectedDevice.schoolName}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6 text-xs">
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Affiliation Board</span>
                        <span className="text-zinc-300 font-semibold flex items-center gap-1 mt-0.5">
                          <Award className="w-3.5 h-3.5 text-accent-violet" />
                          {selectedDevice.schoolBoard}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Class standard</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.schoolStandard || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Section Code</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.schoolSection || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Academic Year</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.schoolAcademicYear || 'N/A'}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Medium(s) of Instruction</span>
                        <span className="text-zinc-300 font-medium mt-0.5 block">{selectedDevice.schoolMediums}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="block text-[10px] text-zinc-500 uppercase font-bold">Class Bind Designation</span>
                        <span className="text-zinc-300 font-semibold mt-0.5 block text-accent-violet">{selectedDevice.schoolClassName || 'N/A'}</span>
                      </div>
                    </div>

                    {/* School Contacts */}
                    <div className="pt-3 border-t border-white/5 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <User className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate"><b>Coord:</b> {selectedDevice.schoolCoordinator}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Mail className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Email:</b> {selectedDevice.schoolEmail}</span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Phone className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate select-all"><b>Phone:</b> {selectedDevice.schoolPhone}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-sidebar-border flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedDevice(null)} className="btn btn-secondary">
                Close
              </button>
              {selectedDevice.status !== 'Revoked' && (
                <button
                  type="button"
                  onClick={(e) => handleDeactivate(e, selectedDevice.id)}
                  disabled={isPending}
                  className="btn btn-danger"
                >
                  <Power className="w-4 h-4" />
                  Deactivate license
                </button>
              )}
            </div>
        </FormModal>
      )}

      {/* Centered Glassmorphic Confirmation & Password Modal */}
      {confirmStep !== 'none' && (
        <FormModal
          open
          onClose={() => { if (!isPending) { setConfirmStep('none'); setDeactivatingDeviceId(null); setDeactivationPassword(''); } }}
          panelClassName="glass relative w-full max-w-md rounded-2xl p-6 flex flex-col space-y-6 animate-slide-up"
        >
            {confirmStep === 'confirm' ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <AlertCircle className="w-6 h-6 text-amber-500" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Confirm Deactivation</h3>
                    <p className="text-xs text-zinc-400 font-medium">Action cannot be undone.</p>
                  </div>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed">
                  Are you sure you want to deactivate this device binding? The node will be disconnected instantly.
                </p>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => {
                      setConfirmStep('none');
                      setDeactivatingDeviceId(null);
                    }}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/15 text-zinc-300 hover:text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setConfirmStep('password')}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold rounded-xl hover:shadow-lg transition-all cursor-pointer"
                  >
                    Yes, Proceed
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                    <Lock className="w-6 h-6 text-rose-400" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Security Verification</h3>
                    <p className="text-xs text-zinc-400 font-medium">Enter deactivation password.</p>
                  </div>
                </div>

                <form
                  onSubmit={e => { e.preventDefault(); handlePasswordSubmit(); }}
                  autoComplete="off"
                >
                  {/* Hidden username for password-manager / a11y (Chrome wants a
                      username field paired with a password field). */}
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    defaultValue="admin"
                    readOnly
                    aria-hidden="true"
                    tabIndex={-1}
                    style={{ display: 'none' }}
                  />
                  <div className="space-y-2">
                    <label htmlFor="deactivation-password" className="block text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Deactivation Password</label>
                    <input
                      id="deactivation-password"
                      name="deactivation-password"
                      type="password"
                      placeholder="Enter password..."
                      autoComplete="current-password"
                      value={deactivationPassword}
                      onChange={e => setDeactivationPassword(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 hover:border-white/15 focus:border-rose-500 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                      autoFocus
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmStep('none');
                        setDeactivatingDeviceId(null);
                        setDeactivationPassword('');
                      }}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/15 text-zinc-300 hover:text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending || !deactivationPassword}
                      className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl hover:shadow-lg transition-all cursor-pointer"
                    >
                      {isPending ? 'Deactivating...' : 'Confirm Deactivation'}
                    </button>
                  </div>
                </form>
              </>
            )}
        </FormModal>
      )}
    </div>
  );
}
