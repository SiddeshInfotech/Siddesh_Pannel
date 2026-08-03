'use client';

import React, { useState, useTransition } from 'react';
import { 
  Key, 
  School as SchoolIcon, 
  Calendar, 
  Lock, 
  ShieldAlert,
  Copy,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  QrCode,
  Sparkles,
  Trash2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  Search,
  X
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import StatusBadge from '@/components/StatusBadge';
import { createActivationKeys, deleteActivationKey, resetDeviceBinding } from './actions';
import { useToast } from '@/components/Toast';
import CustomSelect from '@/components/CustomSelect';

interface SchoolOption {
  id: string;
  name: string;
}

interface KeyRow {
  id: string;
  key: string;
  entityName: string;
  status: 'Unpaid' | 'Paid' | 'Active' | 'Revoked';
  durationDays: number;
  expiresAt?: string | null;
  createdAt: string;
  batchId?: string | null;
  deviceFingerprint?: string | null;
  deviceModel?: string | null;
  deviceOS?: string | null;
  deviceBrand?: string | null;
  deviceAndroidId?: string | null;
  activatedAt?: string | null;
  watermarkCode?: string | null;
}

interface KeysClientProps {
  schools: SchoolOption[];
  keys: KeyRow[];
  vendors: SchoolOption[];
  parents: SchoolOption[];
}

export default function KeysClient({ schools, keys, vendors, parents }: KeysClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [keyList, setKeyList] = useState<KeyRow[]>(keys);
  
  const [entityType, setEntityType] = useState<'School' | 'Vendor' | 'Individual'>('School');
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  
  const [durationMode, setDurationMode] = useState<'1year' | 'custom'>('1year');
  // Custom Time Dropdown Selector States
  const [customDateOnly, setCustomDateOnly] = useState('');
  const [customHour, setCustomHour] = useState('12');
  const [customMinute, setCustomMinute] = useState('00');
  const [customAmpm, setCustomAmpm] = useState('PM');

  let customDate = '';
  if (customDateOnly) {
    let hour24 = parseInt(customHour);
    if (customAmpm === 'PM' && hour24 < 12) hour24 += 12;
    if (customAmpm === 'AM' && hour24 === 12) hour24 = 0;
    const hourStr = String(hour24).padStart(2, '0');
    const minStr = customMinute.padStart(2, '0');
    customDate = `${customDateOnly}T${hourStr}:${minStr}`;
  }

  const keyInputState = useState('LMS-TRIMURTI-BETA');
  const keyInput = keyInputState[0];
  const setKeyInput = keyInputState[1];
  const [keyCount, setKeyCount] = useState(1);
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);
  const [filterSchoolId, setFilterSchoolId] = useState('all');
  // Search by activation token OR forensic watermark code (the faint code seen in a
  // leaked recording) — lets an admin trace a leak straight back to the bound tablet.
  const [searchQuery, setSearchQuery] = useState('');
  
  // Real-time ticking state for exact countdown displays
  const [currentTime, setCurrentTime] = useState(new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Calculate 1 year expiration date
  const oneYearFromNow = new Date();
  oneYearFromNow.setDate(oneYearFromNow.getDate() + 365);
  const oneYearDateStr = oneYearFromNow.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const selectedSchool = schools.find(s => s.id === selectedSchoolId);
  const selectedVendor = vendors.find(v => v.id === selectedVendorId);
  const selectedParent = parents.find(p => p.id === selectedParentId);

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<{ id: string; keyToken: string } | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [keyToReset, setKeyToReset] = useState<{ id: string; keyToken: string } | null>(null);

  const generateRandomKey = (entityName: string) => {
    const entityPrefix = entityName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 8) || 'ENTITY';
    // Activation keys are credentials — use the Web Crypto CSPRNG, not Math.random()
    // (predictable). The 32-symbol alphabet divides 256 evenly, so `byte % 32` is
    // unbiased. Server-side generation (payments/actions.ts) uses the same scheme.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let randCode = '';
    for (let i = 0; i < bytes.length; i++) {
      randCode += chars[bytes[i] % chars.length];
    }
    return `LMS-${entityPrefix}-${randCode}`;
  };

  const handleAutoSuggest = () => {
    let currentName = 'ENTITY';
    if (entityType === 'School') currentName = selectedSchool?.name || 'SCHOOL';
    else if (entityType === 'Vendor') currentName = selectedVendor?.name || 'VENDOR';
    else if (entityType === 'Individual') currentName = selectedParent?.name || 'INDIVIDUAL';
    
    setKeyInput(generateRandomKey(currentName));
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (entityType === 'School' && !selectedSchoolId) ||
      (entityType === 'Vendor' && !selectedVendorId) ||
      (entityType === 'Individual' && !selectedParentId)
    ) {
      toast('Please select an entity first.', 'error');
      return;
    }
    if (keyCount === 1 && !keyInput) {
      toast('Please input an Activation Key.', 'error');
      return;
    }

    let calculatedDays = 365;
    let expiresAtParam = undefined;
    if (durationMode === 'custom') {
      if (!customDate) {
        toast('Please select a custom policy expiration date and time.', 'error');
        return;
      }
      const diffTime = new Date(customDate).getTime() - new Date().getTime();
      calculatedDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      expiresAtParam = new Date(customDate).toISOString();
    }

    let entityName = 'ENTITY';
    if (entityType === 'School') entityName = selectedSchool?.name || 'SCHOOL';
    else if (entityType === 'Vendor') entityName = selectedVendor?.name || 'VENDOR';
    else if (entityType === 'Individual') entityName = selectedParent?.name || 'INDIVIDUAL';

    const keysToCreate: string[] = [];

    if (keyCount === 1) {
      keysToCreate.push(keyInput);
    } else {
      for (let i = 0; i < keyCount; i++) {
        keysToCreate.push(generateRandomKey(entityName));
      }
    }

    startTransition(async () => {
      try {
        const res = await createActivationKeys({
          entityType,
          schoolId: selectedSchoolId,
          vendorId: selectedVendorId,
          parentId: selectedParentId,
          keys: keysToCreate,
          durationDays: calculatedDays,
          expiresAt: expiresAtParam
        });

        if (!res.ok) {
          toast(res.error, 'error');
          return;
        }

        const newKeyRows: KeyRow[] = res.data.map(result => ({
          id: result.id,
          key: result.key,
          entityName: entityName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: result.status as any,
          durationDays: result.durationDays,
          expiresAt: result.expiresAt,
          createdAt: result.createdAt,
          batchId: result.batchId || null,
          deviceFingerprint: null,
          deviceModel: null,
          deviceOS: null,
          deviceBrand: null,
          deviceAndroidId: null,
          activatedAt: null
        }));

        setKeyList(prev => [...newKeyRows, ...prev]);
        setGeneratedKeys(keysToCreate);
        toast(`${keysToCreate.length} Activation key(s) generated successfully!`, 'success');
      } catch {
        toast('Something went wrong. Please try again.', 'error');
      }
    });
  };

  const confirmDelete = (id: string, keyToken: string) => {
    setKeyToDelete({ id, keyToken });
    setShowConfirmModal(true);
  };

  const handleDelete = () => {
    if (!keyToDelete) return;
    
    const target = keyToDelete;
    startTransition(async () => {
      const res = await deleteActivationKey(target.id);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setKeyList(prev => prev.filter(k => k.id !== target.id));
      toast('Activation key deleted successfully.', 'success');
      setShowConfirmModal(false);
      setKeyToDelete(null);
    });
  };

  const confirmReset = (id: string, keyToken: string) => {
    setKeyToReset({ id, keyToken });
    setShowResetModal(true);
  };

  const handleResetBinding = () => {
    if (!keyToReset) return;

    const target = keyToReset;
    startTransition(async () => {
      const res = await resetDeviceBinding(target.id);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setKeyList(prev => prev.map(k => k.id === target.id ? {
        ...k,
        status: 'Paid',
        deviceFingerprint: null,
        deviceModel: null,
        deviceOS: null,
        deviceBrand: null,
        deviceAndroidId: null,
        activatedAt: null,
      } : k));
      toast('Device binding reset. The key can be re-activated on the repaired tablet.', 'success');
      setShowResetModal(false);
      setKeyToReset(null);
    });
  };

  const handleCopy = (keyText: string, index: number) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(keyText);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = keyText;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textArea);
    }
    setCopiedKeyIndex(index);
    toast('Activation key copied to clipboard.', 'success');
    setTimeout(() => setCopiedKeyIndex(null), 2000);
  };

  const keySchools = React.useMemo(() => {
    const unique = new Map<string, string>();
    keyList.forEach(k => {
      unique.set(k.entityName, k.entityName);
    });
    return Array.from(unique.keys()).sort();
  }, [keyList]);

  const filterOptions = React.useMemo(() => {
    return [
      { value: 'all', label: 'All Entities' },
      ...keySchools.map(name => ({ value: name, label: name }))
    ];
  }, [keySchools]);

  const filteredKeyList = React.useMemo(() => {
    let list = filterSchoolId === 'all' ? keyList : keyList.filter(k => k.entityName === filterSchoolId);
    const q = searchQuery.trim().toUpperCase();
    if (q) {
      list = list.filter(k =>
        (k.watermarkCode || '').toUpperCase().includes(q) ||
        (k.key || '').toUpperCase().includes(q)
      );
    }
    return list;
  }, [keyList, filterSchoolId, searchQuery]);

  const batches = React.useMemo(() => {
    const map: { [key: string]: { id: string; entityName: string; createdAt: string; keys: KeyRow[] } } = {};
    filteredKeyList.forEach(k => {
      const batchKey = k.batchId || `legacy-${k.entityName}-${k.createdAt}`;
      if (!map[batchKey]) {
        map[batchKey] = {
          id: batchKey,
          entityName: k.entityName,
          createdAt: k.createdAt,
          keys: []
        };
      }
      map[batchKey].keys.push(k);
    });
    return Object.values(map);
  }, [filteredKeyList]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto relative">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header and branding */}
      <div>
        <h2 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
          <Key className="w-8 h-8 text-accent-violet" />
          Cryptographic Key Provisioning
        </h2>
        <p className="text-xs text-zinc-400 mt-1">
          Generate high-entropy activation tokens for institutional nodes. All keys are encrypted with AES-256 before storage.
        </p>
      </div>

      {/* Main card matching layout */}
      <GlassCard className="/40 border border-white/5 p-8 relative overflow-visible">
        <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-accent-violet/5 rounded-full blur-[80px] pointer-events-none"></div>

        <form onSubmit={handleGenerate} className="space-y-8">
          {/* Entity Type Selection */}
          <div className="w-full md:w-1/3">
            <label className="text-xs font-bold text-zinc-400 block mb-2">Entity Type</label>
            <CustomSelect
              required
              value={entityType}
              onChange={val => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                setEntityType(val as any);
                setSelectedSchoolId('');
                setSelectedVendorId('');
                setSelectedParentId('');
              }}
              options={[
                { value: 'School', label: 'School' },
                { value: 'Vendor', label: 'Vendor' },
                { value: 'Individual', label: 'Normal Individual User' }
              ]}
              placeholder="Select Entity Type"
            />
          </div>

          {/* Top details columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Entity Selection Dropdown */}
            {entityType === 'School' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                  <SchoolIcon className="w-3.5 h-3.5 text-zinc-500" />
                  Select Institution *
                </label>
                <CustomSelect
                  required
                  value={selectedSchoolId}
                  onChange={val => setSelectedSchoolId(val)}
                  options={schools.map(s => ({ value: s.id, label: s.name }))}
                  placeholder="Select School"
                />
              </div>
            )}
            
            {entityType === 'Vendor' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                  <SchoolIcon className="w-3.5 h-3.5 text-zinc-500" />
                  Select Vendor *
                </label>
                <CustomSelect
                  required
                  value={selectedVendorId}
                  onChange={val => setSelectedVendorId(val)}
                  options={vendors.map(v => ({ value: v.id, label: v.name }))}
                  placeholder="Select Vendor"
                />
              </div>
            )}

            {entityType === 'Individual' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                  <SchoolIcon className="w-3.5 h-3.5 text-zinc-500" />
                  Select Individual *
                </label>
                <CustomSelect
                  required
                  value={selectedParentId}
                  onChange={val => setSelectedParentId(val)}
                  options={parents.map(p => ({ value: p.id, label: p.name }))}
                  placeholder="Select Individual"
                />
              </div>
            )}

            {/* Policy Duration */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                Policy Duration *
              </span>
              <div className="flex flex-col gap-3">
                {/* Options toggle */}
                <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
                  <button
                    type="button"
                    onClick={() => setDurationMode('1year')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      durationMode === '1year'
                        ? 'bg-accent-violet text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    1 Year Pre-defined
                  </button>
                  <button
                    type="button"
                    onClick={() => setDurationMode('custom')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      durationMode === 'custom'
                        ? 'bg-accent-violet text-white shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Custom Calendar
                  </button>
                </div>

                {/* Mode views */}
                {durationMode === '1year' ? (
                  <div className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex items-center gap-3 h-[50px] text-zinc-300">
                    <span className="p-1.5 rounded-lg bg-accent-violet/10 text-accent-violet">
                      <Calendar className="w-4 h-4" />
                    </span>
                    <span className="text-xs font-bold text-zinc-300">
                      Expires exactly 365 days from activation (Valid until: {oneYearDateStr})
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row gap-3 items-center">
                    {/* Date Selector */}
                    <div className="flex-1 w-full relative">
                       <input
                         type="date"
                         required={durationMode === 'custom'}
                         value={customDateOnly}
                         onChange={e => setCustomDateOnly(e.target.value)}
                         className="w-full px-4 py-3 bg-[#121216]/60 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-zinc-300 focus:outline-none transition-all"
                       />
                    </div>
                    
                    {/* Hour Dropdown */}
                    <div className="w-full md:w-[110px] relative">
                       <select
                         value={customHour}
                         onChange={e => setCustomHour(e.target.value)}
                         className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-zinc-300 focus:outline-none transition-all appearance-none cursor-pointer"
                       >
                         {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(h => (
                           <option key={h} value={h.padStart(2, '0')} className="bg-[#121216] text-white">{h.padStart(2, '0')} Hr</option>
                         ))}
                       </select>
                    </div>

                    {/* Minute Dropdown */}
                    <div className="w-full md:w-[120px] relative">
                       <select
                         value={customMinute}
                         onChange={e => setCustomMinute(e.target.value)}
                         className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-zinc-300 focus:outline-none transition-all appearance-none cursor-pointer"
                       >
                         {Array.from({ length: 60 }, (_, i) => String(i)).map(m => (
                           <option key={m} value={m.padStart(2, '0')} className="bg-[#121216] text-white">{m.padStart(2, '0')} Min</option>
                         ))}
                       </select>
                    </div>

                    {/* AM / PM Selector */}
                    <div className="w-full md:w-[95px] relative">
                       <select
                         value={customAmpm}
                         onChange={e => setCustomAmpm(e.target.value)}
                         className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-zinc-300 focus:outline-none transition-all appearance-none cursor-pointer"
                       >
                         <option value="AM" className="bg-[#121216] text-white">AM</option>
                         <option value="PM" className="bg-[#121216] text-white">PM</option>
                       </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Key Count & Activation Key input row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Key Count */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                🔢 Key Generation Count
              </label>
              <CustomSelect
                value={String(keyCount)}
                onChange={val => setKeyCount(Number(val))}
                options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({
                  value: String(n),
                  label: `${n} ${n === 1 ? 'Key' : 'Keys'}`
                }))}
              />
            </div>

            {/* Activation Key Identifier */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-bold text-zinc-400 flex items-center gap-2">
                🔒 Activation Key Identifier
              </label>
              <div className="flex gap-4 items-stretch">
                <div className="relative flex-1">
                  <input
                    type="text"
                    required={keyCount === 1}
                    disabled={keyCount > 1}
                    placeholder={keyCount > 1 ? "Auto-generating keys..." : "LMS-EDU-CABE-BETA"}
                    value={keyCount > 1 ? "" : keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    className={`w-full pl-4 ${keyCount === 1 ? 'pr-24' : 'pr-4'} py-3.5 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm font-bold text-white focus:outline-none transition-all tracking-wide font-mono disabled:opacity-50`}
                  />
                  {keyCount === 1 && (
                    <button
                      type="button"
                      onClick={handleAutoSuggest}
                      className="absolute right-3 top-3 px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                      Auto-Suggest
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isPending}
                  className="px-6 py-3.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-bold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-transform active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {isPending ? 'Provisioning...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>

          {/* Audit Compliance banner */}
          <div className="p-4 bg-amber-500/[0.01] border border-amber-500/10 rounded-2xl flex items-start gap-3">
            <span className="p-1 rounded bg-amber-500/10 text-amber-500 mt-0.5">
              <ShieldAlert className="w-4 h-4" />
            </span>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              <strong className="text-zinc-200">Audit Compliance:</strong> This generation event will be logged with your UID and timestamped. Keys generated through this portal are valid for single-instance deployment only.
            </p>
          </div>
        </form>

        {/* Display Generated Results */}
        {generatedKeys.length > 0 && (
          <div className="mt-8 border-t border-white/5 pt-8 space-y-6 animate-fade-in">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Generated Cryptographic Activation Credentials ({generatedKeys.length})
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {generatedKeys.map((keyVal, idx) => (
                <div key={keyVal} className="flex flex-col md:flex-row gap-4 items-center bg-black/35 p-5 rounded-2xl border border-white/5 relative">
                  {/* Copy box */}
                  <div className="flex-1 w-full space-y-3">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block">Activation Token {idx + 1}</span>
                    <div className="flex items-center justify-between p-3 bg-[#121216]/50 border border-white/10 rounded-xl font-mono text-xs font-bold text-emerald-400 tracking-wider">
                      <span className="truncate mr-2">{keyVal}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(keyVal, idx)}
                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer flex-shrink-0"
                      >
                        {copiedKeyIndex === idx ? (
                          <span className="text-[9px] font-bold text-emerald-400">Copied!</span>
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>


                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Batch-wise Activation Credentials View */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-lg font-extrabold text-white tracking-tight">Generated Activation Credentials</h3>
            <span className="text-xs font-bold text-zinc-400">
              Total Batches: {batches.length} • Total Keys: {filteredKeyList.length}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            <div className="relative w-full sm:w-[230px]">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search token or WM code…"
                className="w-full pl-9 pr-3 py-2.5 bg-[#121216]/60 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-xs text-zinc-200 focus:outline-none transition-all font-mono tracking-wide"
              />
            </div>
            <div className="flex items-center gap-3 w-full sm:w-[260px]">
              <span className="text-xs font-bold text-zinc-400 whitespace-nowrap">Filter School:</span>
              <CustomSelect
                value={filterSchoolId}
                onChange={val => setFilterSchoolId(val)}
                options={filterOptions}
              />
            </div>
          </div>
        </div>

        {batches.length > 0 ? (
          batches.map((batch) => {
            const activeCount = batch.keys.filter(k => k.status?.toLowerCase() === 'active').length;
            const isBatchActive = activeCount > 0;
            
            return (
              <GlassCard key={batch.id} className="/30 border border-white/5 p-6 space-y-4 hover:border-white/10 transition-all">
                {/* Batch Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-accent-violet uppercase tracking-widest block font-mono">
                      {batch.id.startsWith('BATCH-') ? batch.id : 'Legacy Batch Run'}
                    </span>
                    <h4 className="text-base font-bold text-white flex items-center gap-2">
                      <SchoolIcon className="w-4 h-4 text-zinc-400" />
                      {batch.entityName}
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-zinc-400">
                    <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[10px] font-mono">
                      📅 Provisioned: {batch.createdAt}
                    </span>
                    <span className={`px-3 py-1 rounded-lg text-[10px] font-bold ${
                      activeCount === batch.keys.length 
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                        : isBatchActive
                        ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                        : 'bg-zinc-500/10 border border-white/10 text-zinc-400'
                    }`}>
                      📱 {activeCount} / {batch.keys.length} Activated
                    </span>
                  </div>
                </div>

                {/* Batch Keys List - Flex row cards for maximum contrast and legibility */}
                <div className="space-y-3 pt-2">
                  {batch.keys.map((k) => {
                    const expiryDate = k.expiresAt ? new Date(k.expiresAt) : null;
                    let daysLeftText = 'Not Activated';
                    let isExpired = false;

                    if (expiryDate) {
                      const diffTime = expiryDate.getTime() - currentTime.getTime();
                      if (diffTime <= 0) {
                        daysLeftText = 'Expired';
                        isExpired = true;
                      } else {
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const diffMins = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));

                        if (diffDays > 0) {
                          daysLeftText = `${diffDays}d ${diffHours}h left`;
                        } else if (diffHours > 0) {
                          daysLeftText = `${diffHours}h ${diffMins}m left`;
                        } else {
                          daysLeftText = `${diffMins}m left`;
                        }
                      }
                    }

                    const hasDevice = !!k.deviceFingerprint || !!k.deviceModel;

                    return (
                      <div 
                        key={k.id} 
                        className="flex flex-col lg:flex-row lg:items-center justify-between p-4 bg-[#09090b]/40 border border-white/5 hover:border-white/10 rounded-xl gap-4 transition-all"
                      >
                        {/* Token and Copy Button */}
                        <div className="flex items-center justify-between lg:justify-start gap-3 min-w-[220px]">
                          <span className="font-mono text-sm font-bold text-emerald-500 select-all tracking-wide activation-token">
                            {k.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(k.key, 0)}
                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer flex-shrink-0"
                            title="Copy Token"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Forensic watermark code — matches the faint code shown during
                            playback; paste a leaked recording's code in Search to find this. */}
                        <div
                          className="flex items-center gap-2 min-w-[130px]"
                          title="Forensic watermark code shown faintly during video playback. Search a leaked recording's code above to trace the bound tablet."
                        >
                          <span className="text-zinc-500 uppercase tracking-widest text-[9px]">WM</span>
                          {k.watermarkCode ? (
                            <span className="font-mono text-xs font-bold text-accent-violet bg-accent-violet/10 border border-accent-violet/20 rounded px-2 py-1 select-all">
                              {k.watermarkCode}
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-600 font-mono" title="Code is recorded on first activation.">—</span>
                          )}
                        </div>

                        {/* Expiry / Policy Details */}
                        <div className="flex items-center justify-between lg:justify-start gap-2 text-xs font-semibold">
                          <span className="text-zinc-500 uppercase tracking-widest text-[9px] lg:hidden block mr-1">Policy:</span>
                          <div className="space-y-0.5">
                            <span className="text-zinc-300">
                              {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('en-IN') : `${k.durationDays} Days`}
                            </span>
                            <span className={`block text-[10px] font-bold ${
                              isExpired 
                                ? 'text-rose-500/90' 
                                : daysLeftText === 'Not Activated' 
                                ? 'text-zinc-500' 
                                : 'text-emerald-500'
                            }`}>
                              {daysLeftText}
                            </span>
                          </div>
                        </div>

                        {/* Device Binding Info */}
                        <div className="flex-1 min-w-[220px]">
                          {hasDevice ? (
                            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-2.5 w-full max-w-[320px]">
                              <div className="p-1.5 rounded bg-accent-violet/10 text-accent-violet flex-shrink-0 text-xs">
                                📱
                              </div>
                              <div className="space-y-0.5 min-w-0">
                                <div className="font-bold text-white text-xs truncate">
                                  {k.deviceBrand || ''} {k.deviceModel || 'Unknown Device'}
                                </div>
                                <div className="text-[10px] text-zinc-500 font-mono truncate">
                                  OS: {k.deviceOS || 'Android'} • ID: {k.deviceAndroidId || 'N/A'}
                                </div>
                                {k.activatedAt && (
                                  <div className="text-[9px] text-emerald-400 font-bold">
                                    Activated: {k.activatedAt}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-zinc-500 font-medium flex items-center gap-2 py-1 text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 animate-pulse"></span>
                              <span>Waiting for device activation</span>
                            </div>
                          )}
                        </div>

                        {/* Status and Action Buttons */}
                        <div className="flex items-center justify-between lg:justify-end gap-4 border-t lg:border-t-0 border-white/5 pt-3 lg:pt-0">
                          <StatusBadge status={k.status?.toLowerCase() === 'active' ? 'Active' : k.status?.toLowerCase() === 'revoked' ? 'Revoked' : k.status?.toLowerCase() === 'paid' ? 'SUCCESS' : 'Unpaid'} />

                          {hasDevice && (
                            <button
                              type="button"
                              onClick={() => confirmReset(k.id, k.key)}
                              className="p-2 bg-white/5 hover:bg-amber-500/10 rounded-lg text-zinc-400 hover:text-amber-400 border border-white/5 hover:border-amber-500/20 transition-colors cursor-pointer"
                              title="Reset device binding (for a repaired / factory-reset tablet)"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => confirmDelete(k.id, k.key)}
                            className="p-2 bg-white/5 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400 border border-white/5 hover:border-red-500/20 transition-colors cursor-pointer"
                            title="Delete Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            );
          })
        ) : (
          <GlassCard className="/40 border border-white/5 p-12 text-center text-zinc-500">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-zinc-600" />
            No activation keys provisioned yet.
          </GlassCard>
        )}
      </div>

      {/* Deletion Confirmation Modal */}
      {showConfirmModal && keyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <GlassCard className="w-full max-w-md border border-white/10 p-6 space-y-6 shadow-2xl relative">
            <button 
              onClick={() => {
                setShowConfirmModal(false);
                setKeyToDelete(null);
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
                <h3 className="text-lg font-bold text-white">Confirm Key Deletion</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Are you absolutely sure you want to delete the activation key <strong className="text-zinc-200">{keyToDelete.keyToken}</strong>?
                </p>
                <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-rose-400 font-semibold leading-relaxed">
                    ⚠️ CRITICAL NOTE: This activation key will be permanently deleted and any tablet device currently bound to this token will be instantly disconnected.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setKeyToDelete(null);
                }}
                disabled={isPending}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all cursor-pointer disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-all cursor-pointer disabled:opacity-55"
              >
                {isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {showResetModal && keyToReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <GlassCard className="w-full max-w-md border border-white/10 p-6 space-y-6 shadow-2xl relative">
            <button
              onClick={() => {
                setShowResetModal(false);
                setKeyToReset(null);
              }}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl">
                <RotateCcw className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Reset Device Binding</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Unbind the current tablet from key <strong className="text-zinc-200">{keyToReset.keyToken}</strong> so it can be re-activated on a repaired or factory-reset device?
                </p>
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-amber-400 font-semibold leading-relaxed">
                    The license expiry is unchanged (this is not a renewal). The currently bound tablet will stop working until a device re-activates this key. This action is logged.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setKeyToReset(null);
                }}
                disabled={isPending}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all cursor-pointer disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                onClick={handleResetBinding}
                disabled={isPending}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer disabled:opacity-55"
              >
                {isPending ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
