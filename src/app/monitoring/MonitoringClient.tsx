'use client';

import React, { useState, useTransition } from 'react';
import { 
  Laptop, 
  Smartphone, 
  Tv, 
  Monitor, 
  Search, 
  Globe,
  AlertCircle,
  X,
  Shield,
  Info,
  Calendar,
  Hash,
  User,
  Mail,
  Phone,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Layers,
  Award,
  Clock,
  Key,
  BookOpen,
  Lock
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import StatusBadge from '@/components/StatusBadge';
import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import { deactivateDevice } from './actions';
import { useToast } from '@/components/Toast';

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
  lastSync: string;
  exactLastSync: string;
  remainingTime: string;
  status: 'Active' | 'Inactive' | 'Revoked' | 'Unpaid' | 'Paid';
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
}

// Maps the device security tier (KeystoreCrypto taxonomy) to a short label + badge
// colour. Strong hardware attestation → green; can't-attest tiers → amber/blue;
// failure tiers → red; devices activated before the field existed → neutral.
function tierStyle(tier: string): { label: string; cls: string } {
  switch (tier) {
    case 'ATTESTED_STRONGBOX':
      return { label: 'StrongBox', cls: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' };
    case 'ATTESTED_TEE':
      return { label: 'TEE (attested)', cls: 'bg-green-500/10 border-green-500/25 text-green-400' };
    case 'KEYSTORE_PLAIN':
      return { label: 'Keystore (no chain)', cls: 'bg-amber-500/10 border-amber-500/25 text-amber-400' };
    case 'TEE_LEGACY_NOATTEST':
      return { label: 'TEE legacy', cls: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400' };
    case 'MODEL_SKIP':
      return { label: 'Model skip', cls: 'bg-sky-500/10 border-sky-500/25 text-sky-400' };
    case 'SW_ONLY':
      return { label: 'Software only', cls: 'bg-orange-500/10 border-orange-500/25 text-orange-400' };
    case 'PROVISION_FAILED':
      return { label: 'Provision failed', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-400' };
    case 'CEK_DECRYPT_FAILED':
      return { label: 'CEK failed', cls: 'bg-rose-500/10 border-rose-500/25 text-rose-400' };
    default:
      return { label: 'Unreported', cls: 'bg-white/5 border-white/10 text-zinc-400' };
  }
}

interface MonitoringClientProps {
  initialDevices: DeviceRow[];
  totalDevicesCount: number;
}

export default function MonitoringClient({ initialDevices, totalDevicesCount }: MonitoringClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState<'Schools' | 'Vendors' | 'Users'>('Schools');
  const [selectedDevice, setSelectedDevice] = useState<DeviceRow | null>(null);
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

  const filteredDevices = devicesList.filter(dev => {
    if (entityFilter !== 'Schools') return false; // Database doesn't have Vendor/User devices yet
    return dev.model.toLowerCase().includes(search.toLowerCase()) || 
    dev.fingerprint.toLowerCase().includes(search.toLowerCase()) ||
    dev.schoolName.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header and Controls */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <Globe className="w-8 h-8 text-accent-violet animate-pulse" />
            Device Monitoring
          </h2>
          <p className="text-xs text-zinc-400 mt-1">Real-time hardware fingerprint validation and device states.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-[180px]">
            <CustomSelect
              value={entityFilter}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={val => setEntityFilter(val as any)}
              options={[
                { value: 'Schools', label: 'Schools' },
                { value: 'Vendors', label: 'Vendors' },
                { value: 'Users', label: 'Users' }
              ]}
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4.5 h-4.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by fingerprints, model, school..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none w-[320px] transition-all"
            />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="max-w-sm">
        <MetricCard
          title="Total Devices"
          value={totalDevicesCount.toString()}
          badgeText="Active DB Nodes"
          badgeType="stable"
          icon={Laptop}
          sparklineType="progress"
          progress={totalDevicesCount > 0 ? Math.min(100, (totalDevicesCount / 100) * 100) : 0}
        />
      </div>

      {/* Main Table list */}
      <GlassCard className="/40 border border-card-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left border-collapse">
            <thead>
              <tr className="border-b border-card-border text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                <th className="py-4 px-3">Device (Model + OS)</th>
                <th className="py-4 px-3">Hardware Fingerprint</th>
                <th className="py-4 px-3">School Name</th>
                <th className="py-4 px-3">Security Tier</th>
                <th className="py-4 px-3">Activation</th>
                <th className="py-4 px-3">Last Sync</th>
                <th className="py-4 px-3">Remaining Time</th>
                <th className="py-4 px-3">Status</th>
                <th className="py-4 px-3 text-right">Deactivate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {filteredDevices.length > 0 ? (
                filteredDevices.map(dev => {
                  const Icon = getDeviceIcon(dev.model, dev.os);
                  return (
                    <tr 
                      key={dev.id} 
                      onClick={() => setSelectedDevice(dev)}
                      className="hover:bg-white/[0.02] active:bg-white/[0.04] transition-all cursor-pointer group"
                    >
                      <td className="py-4 px-3">
                        <div className="flex items-center gap-3">
                          <span className="p-2 rounded-xl bg-white/5 border border-white/10 group-hover:border-accent-violet/30 transition-all">
                            <Icon className="w-4.5 h-4.5 text-zinc-400 group-hover:text-accent-violet transition-colors" />
                          </span>
                          <div>
                            <h4 className="text-sm font-semibold text-white group-hover:text-accent-violet transition-colors">{dev.model}</h4>
                            <p className="text-[10px] text-zinc-500 font-medium">{dev.os}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <code className="text-xs px-2.5 py-1 bg-white/5 border border-white/5 rounded-lg text-zinc-400 font-mono group-hover:text-zinc-200 transition-colors">
                          {dev.fingerprint.substring(0, 12)}...
                        </code>
                      </td>
                      <td className="py-4 px-3 text-sm font-bold text-zinc-300 group-hover:text-white transition-colors">{dev.schoolName}</td>
                      <td className="py-4 px-3">
                        {(() => {
                          const t = tierStyle(dev.securityTier);
                          return (
                            <span
                              title={dev.securityTier}
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[10px] font-semibold whitespace-nowrap ${t.cls}`}
                            >
                              {t.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-4 px-3 text-sm text-zinc-300 font-medium">{dev.activationDate}</td>
                      <td className="py-4 px-3 text-sm text-zinc-400">{dev.lastSync}</td>
                      <td className="py-4 px-3 text-sm text-zinc-400 font-medium font-mono">{dev.remainingTime}</td>
                      <td className="py-4 px-3">
                        <StatusBadge status={dev.status} />
                      </td>
                      <td className="py-4 px-3 text-right">
                        {dev.status !== 'Revoked' ? (
                          <button
                            type="button"
                            onClick={(e) => handleDeactivate(e, dev.id)}
                            disabled={isPending}
                            className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/20 text-xs font-semibold text-rose-400 rounded-lg hover:shadow-md transition-all cursor-pointer disabled:opacity-55"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            disabled
                            className="px-3.5 py-1.5 bg-zinc-800 border border-white/5 text-xs font-semibold text-zinc-500 rounded-lg cursor-not-allowed"
                          >
                            Deactivated
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-zinc-500 text-sm">
                    {/* colSpan spans all columns incl. the Security Tier column */}
                    <AlertCircle className="w-5 h-5 mx-auto mb-2 text-zinc-600" />
                    No registered devices matching search filters found in the database.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Modern Premium Glassmorphic Modal overlay */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm transition-all duration-300 animate-in fade-in">
          <div 
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-[#0e0e12]/95 border border-white/10 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-xl bg-accent-violet/10 border border-accent-violet/20">
                  {React.createElement(getDeviceIcon(selectedDevice.model, selectedDevice.os), {
                    className: 'w-6 h-6 text-accent-violet'
                  })}
                </span>
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                    {selectedDevice.model}
                    <StatusBadge status={selectedDevice.status} />
                  </h3>
                  <p className="text-xs text-zinc-400 font-medium">OS: {selectedDevice.os} &bull; Handshake Verification Details</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedDevice(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content - Scrollable */}
            <div className="p-6 overflow-y-auto space-y-6">
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
                        <Shield className="w-3 h-3 text-zinc-500" /> Security Tier
                      </span>
                      {(() => {
                        const t = tierStyle(selectedDevice.securityTier);
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-semibold mt-0.5 ${t.cls}`}>
                            {t.label}
                          </span>
                        );
                      })()}
                      <code className="block text-[10px] text-zinc-500 font-mono mt-1">{selectedDevice.securityTier}</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. School Profile Binding */}
              <div>
                <h4 className="text-xs font-extrabold uppercase text-accent-violet tracking-wider mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  School Information Binding
                </h4>
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
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-white/5 bg-white/[0.01] flex justify-end gap-3">
              {selectedDevice.status !== 'Revoked' ? (
                <button
                  type="button"
                  onClick={(e) => handleDeactivate(e, selectedDevice.id)}
                  disabled={isPending}
                  className="px-4 py-2 bg-rose-500 hover:bg-rose-600 active:bg-rose-700 text-white text-xs font-semibold rounded-xl hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  Deactivate Device License
                </button>
              ) : null}
              <button 
                onClick={() => setSelectedDevice(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/15 text-zinc-300 hover:text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Glassmorphic Confirmation & Password Modal */}
      {confirmStep !== 'none' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm transition-all duration-300 animate-in fade-in">
          <div 
            className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#0e0e12]/95 border border-white/10 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200 p-6 flex flex-col space-y-6"
            onClick={e => e.stopPropagation()}
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
          </div>
        </div>
      )}
    </div>
  );
}
