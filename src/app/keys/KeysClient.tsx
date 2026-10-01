'use client';

import React, { useState, useTransition, useRef, useEffect } from 'react';
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
  ChevronDown,
  Plus,
  Layers,
  ChevronLeft,
  ChevronRight,
  X,
  Monitor,
  FileDown,
  CheckCircle2,
  CalendarX,
  Ban
} from 'lucide-react';
import EntityAvatar from '@/components/EntityAvatar';
import GlassCard from '@/components/GlassCard';
import StatusBadge from '@/components/StatusBadge';
import AppleDatePicker from '@/components/AppleDatePicker';
import { createActivationKeys, deleteActivationKey, resetDeviceBinding, setKeyDeviceClass } from './actions';
import { useToast } from '@/components/Toast';
import CustomSelect from '@/components/CustomSelect';
import { DEFAULT_PRODUCT_ID, productDisplayName, ProductId, isProductId, targetOsFor, productsForPanel, defaultProductForPanel, productFilterOptionsFor } from '@/lib/productIdentity';
import {
  DEVICE_CLASS_OPTIONS,
  DEVICE_CLASS_STANDARD,
  DEVICE_CLASS_MANAGED_PANEL,
  DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS,
  MAX_PANEL_ACTIVATION_WINDOW_DAYS,
  deviceClassLabel,
  type DeviceClass,
} from '@/lib/deviceClass';

/** Interactive-panel keys exist only for Android products; an unset product is legacy School Android. */
function isAndroidProduct(productId: string | null | undefined): boolean {
  return targetOsFor(isProductId(productId) ? productId : DEFAULT_PRODUCT_ID) === 'ANDROID';
}

/** Product label with the device type appended for panel keys (key list, batch PDF). */
function productWithDeviceClass(productId: string | null | undefined, deviceClass: string | null | undefined): string {
  const product = productDisplayName(productId);
  return deviceClass === DEVICE_CLASS_MANAGED_PANEL ? `${product} · ${deviceClassLabel(deviceClass)}` : product;
}
import { downloadActivationKeysPdf } from '@/lib/keysPdf';

interface SchoolOption {
  id: string;
  name: string;
}

interface KeyRow {
  id: string;
  key: string;
  entityName: string;
  // Exactly one of these is set — determines the entity type for the two-level filter.
  schoolId?: string;
  vendorId?: string;
  parentId?: string;
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
  platform?: string | null;        // 'android' | 'windows'
  securityTier?: string | null;
  productId?: string | null;       // canonical product id (src/lib/productIdentity.ts)
  deviceClass?: string | null;     // null = Standard; 'managed_panel' = Interactive panel (src/lib/deviceClass.ts)
  panelActivateBy?: string | null; // Interactive panel: an unused key dies after this
  panelReplacedAt?: string | null; // Interactive panel: the same panel later activated a newer key
}

interface KeysClientProps {
  schools: SchoolOption[];
  keys: KeyRow[];
  vendors: SchoolOption[];
  parents: SchoolOption[];
  /** Signed-in admin's panel: Lab-Admin generates keys for the 5 LMS-Lab products only. */
  panel: 'lms' | 'lab';
}

// DOM budget for the two lists that can be fed a 10,000-key vendor batch. Neither list
// is virtualized, so both mount a bounded slice and grow on demand instead of rendering
// every key up front (which froze the page once batch generation became possible).
const RESULTS_PAGE_SIZE = 100;
const BATCH_KEYS_PAGE_SIZE = 25;
// Past this size a batch isn't practical to read on screen, so its PDF export is always
// offered — not just for the batch that happens to have been generated this session.
const PDF_EXPORT_MIN_KEYS = 10;

export default function KeysClient({ schools, keys, vendors, parents, panel }: KeysClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [keyList, setKeyList] = useState<KeyRow[]>(keys);
  // Re-sync when the server sends a fresh list (revalidatePath after generate/delete/
  // reset). Without this the optimistic local list is the ONLY source after mount, so
  // anything the server committed that the client didn't add itself — e.g. the earlier
  // chunks of a batch whose later chunk failed — stayed invisible until a hard reload.
  // Same pattern PaymentsClient uses for initialPayments.
  const [prevKeys, setPrevKeys] = useState(keys);
  if (keys !== prevKeys) {
    setPrevKeys(keys);
    setKeyList(keys);
  }
  
  const [entityType, setEntityType] = useState<'School' | 'Vendor' | 'Individual'>('School');
  const [productId, setProductId] = useState<ProductId>(defaultProductForPanel(panel));
  // Standard (phones / tablets, full security) vs Interactive panel — Android products only.
  const [deviceClass, setDeviceClass] = useState<DeviceClass>(DEVICE_CLASS_STANDARD);
  const [activateWithinDays, setActivateWithinDays] = useState<number>(DEFAULT_PANEL_ACTIVATION_WINDOW_DAYS);
  const productIsAndroid = targetOsFor(productId) === 'ANDROID';
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

  // Indian academic year (Apr–Mar) captured on the key at generation. Mirrors
  // indianAcademicYear() on the server. For a custom expiry we use that date, else now.
  // Shown to the operator and (for a Vendor key) surfaced as the app's generic "Year".
  const licenseAcademicYear = React.useMemo(() => {
    const d = durationMode === 'custom' && customDate ? new Date(customDate) : new Date();
    const y = d.getFullYear();
    const start = d.getMonth() + 1 >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }, [durationMode, customDate]);

  // Start EMPTY and auto-fill with a valid, entity-named key below (see effect).
  // The old static default 'LMS-TRIMURTI-BETA' could never pass the server format
  // (LMS-<2..12>-<EXACTLY 10>), so a single-key submit was always rejected with
  // "Invalid activation key format." keyManuallyEdited turns auto-fill off once the
  // operator types their own key.
  const keyInputState = useState('');
  const keyInput = keyInputState[0];
  const setKeyInput = keyInputState[1];
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);
  const [keyCount, setKeyCount] = useState(1);
  // NC-1: Vendor-only choice between the existing 1-10 dropdown ("single") and a
  // free-form bulk count ("batch", 11-10,000) — School/Individual always behave as
  // "single" and are otherwise completely unaffected by this state.
  const [vendorKeyMode, setVendorKeyMode] = useState<'single' | 'batch'>('single');
  // String state (not number) so the field can be freely cleared/retyped while editing,
  // matching the existing "Keys Issued Count" numeric input pattern in the Payments tab.
  const [batchKeyCount, setBatchKeyCount] = useState('100');
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  // Captured at generation time (not re-derived from current form state), so switching
  // entity/mode afterward can't retroactively change how the results below are shown.
  const [wasBatchGeneration, setWasBatchGeneration] = useState(false);
  const [lastBatchMeta, setLastBatchMeta] = useState<{
    entityName: string; batchId: string | null; productLabel: string; durationLabel: string;
  } | null>(null);
  // How many freshly-generated keys are actually mounted. A batch can be 10,000 keys;
  // rendering every row at once locks the browser up, so only a slice is in the DOM and
  // the full list is delivered by the PDF.
  const [resultsVisibleCount, setResultsVisibleCount] = useState(RESULTS_PAGE_SIZE);
  // Per-batch expansion in the history list below, keyed by batch id.
  const [batchVisibleCounts, setBatchVisibleCounts] = useState<Record<string, number>>({});
  // Per-batch collapse (chevron in the batch header). Absent = expanded, so every batch
  // still opens by default exactly as before.
  const [collapsedBatches, setCollapsedBatches] = useState<Record<string, boolean>>({});
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);
  // Two-level filter (image 2): first pick the entity TYPE, then a specific entity
  // of that type (or all of that type). filterSchoolId holds the selected entity name.
  const [filterEntityType, setFilterEntityType] = useState<'all' | 'School' | 'Vendor' | 'Parent'>('all');
  const [filterProductId, setFilterProductId] = useState<string>('all');
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
    setKeyManuallyEdited(false);
  };

  // Keep the single-key field populated with a VALID auto-generated key that reflects
  // the chosen entity, until the operator manually edits it. Runs client-side only
  // (generateRandomKey uses Web Crypto), so it never executes during SSR.
  React.useEffect(() => {
    if (keyCount !== 1 || keyManuallyEdited) return;
    let currentName = 'ENTITY';
    if (entityType === 'School') currentName = selectedSchool?.name || 'SCHOOL';
    else if (entityType === 'Vendor') currentName = selectedVendor?.name || 'VENDOR';
    else if (entityType === 'Individual') currentName = selectedParent?.name || 'INDIVIDUAL';
    setKeyInput(generateRandomKey(currentName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, selectedSchoolId, selectedVendorId, selectedParentId, keyCount, keyManuallyEdited]);

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
    // NC-1: Vendor "Batch key generation" replaces the 1-10 dropdown with a free-form
    // count (11-10,000) and always auto-generates every key — there is no single manual
    // key field in that mode (same reason the manual field already hides whenever the
    // existing dropdown's keyCount > 1).
    const isVendorBatch = entityType === 'Vendor' && vendorKeyMode === 'batch';
    const parsedBatchCount = parseInt(batchKeyCount);
    const requestedCount = isVendorBatch ? parsedBatchCount : keyCount;

    if (!isVendorBatch && requestedCount === 1 && !keyInput) {
      toast('Please input an Activation Key.', 'error');
      return;
    }
    if (isVendorBatch && (!Number.isFinite(parsedBatchCount) || parsedBatchCount < 11 || parsedBatchCount > 10000)) {
      toast('Batch count must be between 11 and 10,000.', 'error');
      return;
    }

    let calculatedDays = 365;
    let expiresAtParam = undefined;
    let durationLabel = `${calculatedDays} Days (until ${oneYearDateStr})`;
    if (durationMode === 'custom') {
      if (!customDate) {
        toast('Please select a custom policy expiration date and time.', 'error');
        return;
      }
      const diffTime = new Date(customDate).getTime() - new Date().getTime();
      calculatedDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      expiresAtParam = new Date(customDate).toISOString();
      durationLabel = new Date(customDate).toLocaleString('en-IN');
    }

    let entityName = 'ENTITY';
    if (entityType === 'School') entityName = selectedSchool?.name || 'SCHOOL';
    else if (entityType === 'Vendor') entityName = selectedVendor?.name || 'VENDOR';
    else if (entityType === 'Individual') entityName = selectedParent?.name || 'INDIVIDUAL';

    // Batch mode sends only the COUNT — the server mints the key values with its own
    // CSPRNG, so thousands of credentials never originate in (or are predictable to)
    // the browser. The existing single/small-run path still sends explicit keys, so the
    // operator-typed key and Auto-Suggest behave exactly as before.
    const keysToCreate: string[] = [];

    if (!isVendorBatch) {
      if (requestedCount === 1) {
        keysToCreate.push(keyInput);
      } else {
        for (let i = 0; i < requestedCount; i++) {
          keysToCreate.push(generateRandomKey(entityName));
        }
      }
    }

    startTransition(async () => {
      try {
        const res = await createActivationKeys({
          entityType,
          schoolId: selectedSchoolId,
          vendorId: selectedVendorId,
          parentId: selectedParentId,
          ...(isVendorBatch
            ? { generateCount: requestedCount }
            : { keys: keysToCreate }),
          durationDays: calculatedDays,
          expiresAt: expiresAtParam,
          productId,
          deviceClass: productIsAndroid ? deviceClass : DEVICE_CLASS_STANDARD,
          activateWithinDays,
        });

        if (!res.ok) {
          toast(res.error, 'error');
          return;
        }

        const newKeyRows: KeyRow[] = res.data.map(result => ({
          id: result.id,
          key: result.key,
          entityName: entityName,
          schoolId: entityType === 'School' ? selectedSchoolId : undefined,
          vendorId: entityType === 'Vendor' ? selectedVendorId : undefined,
          parentId: entityType === 'Individual' ? selectedParentId : undefined,
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
          activatedAt: null,
          productId,
          deviceClass: productIsAndroid && deviceClass === DEVICE_CLASS_MANAGED_PANEL ? DEVICE_CLASS_MANAGED_PANEL : null,
        }));

        // In batch mode the key VALUES come back from the server (it minted them), so the
        // results list and the PDF are both driven by what was actually persisted.
        const issuedKeys = isVendorBatch ? res.data.map(r => r.key) : keysToCreate;

        setKeyList(prev => [...newKeyRows, ...prev]);
        setGeneratedKeys(issuedKeys);
        setResultsVisibleCount(RESULTS_PAGE_SIZE); // fresh batch — start from the top slice again
        setWasBatchGeneration(isVendorBatch);
        setLastBatchMeta(isVendorBatch ? {
          entityName,
          batchId: res.data[0]?.batchId ?? null,
          productLabel: productWithDeviceClass(productId, productIsAndroid ? deviceClass : null),
          durationLabel,
        } : null);
        // Re-enable auto-fill so the next single-key submit gets a fresh, unique key
        // (submitting the same token again would collide on the unique constraint).
        setKeyManuallyEdited(false);
        toast(`${issuedKeys.length} Activation key(s) generated successfully!`, 'success');
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

  // Switch an existing key between Standard and Interactive panel. Applies at the key's next
  // activation, so a key already bound to a device also needs Reset Device Binding.
  const toggleDeviceClass = (k: KeyRow) => {
    const next: DeviceClass = k.deviceClass === DEVICE_CLASS_MANAGED_PANEL ? DEVICE_CLASS_STANDARD : DEVICE_CLASS_MANAGED_PANEL;
    const boundNote = k.deviceFingerprint
      ? '\n\nThis key is already bound to a device. The change applies at the next activation — use Reset Device Binding, then activate again on the panel.'
      : '';
    const message = next === DEVICE_CLASS_MANAGED_PANEL
      ? `Mark ${k.key} as an INTERACTIVE PANEL key?\n\nAny Android panel activated with it is accepted without Google hardware attestation and may play video on panel firmware with a root binary. Use only for classroom panels.${boundNote}`
      : `Change ${k.key} back to a STANDARD key (full security)?${boundNote}`;
    if (!window.confirm(message)) return;

    startTransition(async () => {
      const res = await setKeyDeviceClass(k.id, next);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      setKeyList(prev => prev.map(x => x.id === k.id
        ? { ...x, deviceClass: next === DEVICE_CLASS_MANAGED_PANEL ? DEVICE_CLASS_MANAGED_PANEL : null }
        : x));
      toast(`${k.key} is now a ${deviceClassLabel(next)} key.`, 'success');
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
      const wasPanel = keyList.find(k => k.id === target.id)?.deviceClass === DEVICE_CLASS_MANAGED_PANEL;
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
      toast(wasPanel
        ? 'Panel reset. The old panel is shut off at its next online check-in; the key can now activate the replacement panel.'
        : 'Device binding reset. The key can be re-activated on the repaired tablet.', 'success');
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

  const keyEntityType = (k: KeyRow): 'School' | 'Vendor' | 'Parent' =>
    k.vendorId ? 'Vendor' : k.parentId ? 'Parent' : 'School';

  // Entity names available for the second dropdown, scoped to the chosen type.
  const keySchools = React.useMemo(() => {
    const unique = new Map<string, string>();
    keyList.forEach(k => {
      if (filterEntityType !== 'all' && keyEntityType(k) !== filterEntityType) return;
      unique.set(k.entityName, k.entityName);
    });
    return Array.from(unique.keys()).sort();
  }, [keyList, filterEntityType]);

  const filterOptions = React.useMemo(() => {
    const allLabel =
      filterEntityType === 'School' ? 'All Schools'
      : filterEntityType === 'Vendor' ? 'All Vendors'
      : filterEntityType === 'Parent' ? 'All Parents'
      : 'All Entities';
    return [
      { value: 'all', label: allLabel },
      ...keySchools.map(name => ({ value: name, label: name }))
    ];
  }, [keySchools, filterEntityType]);

  const filteredKeyList = React.useMemo(() => {
    let list = keyList;
    if (filterEntityType !== 'all') list = list.filter(k => keyEntityType(k) === filterEntityType);
    if (filterSchoolId !== 'all') list = list.filter(k => k.entityName === filterSchoolId);
    const q = searchQuery.trim().toUpperCase();
    if (q) {
      list = list.filter(k =>
        (k.watermarkCode || '').toUpperCase().includes(q) ||
        (k.key || '').toUpperCase().includes(q) ||
        (k.entityName || '').toUpperCase().includes(q)
      );
    }
    // No default-to-School fallback here: a legacy key with product_id still unresolved
    // (e.g. a pre-migration Windows key awaiting self-heal on next activation) must not be
    // silently counted under a specific product filter — it only shows under "All Products".
    if (filterProductId !== 'all') list = list.filter(k => k.productId === filterProductId);
    return list;
  }, [keyList, filterEntityType, filterSchoolId, searchQuery, filterProductId]);

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
  // New state for popup modal form & generated keys popup
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [showGeneratedPopup, setShowGeneratedPopup] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Paid' | 'Unpaid' | 'Revoked' | 'Expired'>('All');
  const [filterDate, setFilterDate] = useState('');
  const [isProductMenuOpen, setIsProductMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 15;
  const productMenuRef = useRef<HTMLDivElement>(null);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterEntityType, filterSchoolId, filterProductId, statusFilter, filterDate, panel, searchQuery]);

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

  const handleCancelKeyForm = () => {
    setShowKeyForm(false);
  };

  const keyMatchesStatus = (k: KeyRow, status: typeof statusFilter): boolean => {
    const s = (k.status || '').toLowerCase();
    if (status === 'Expired') {
      if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return true;
      if (k.activatedAt && !k.expiresAt) {
        const activeDate = new Date(k.activatedAt).getTime();
        const durationMs = k.durationDays * 24 * 60 * 60 * 1000;
        if (activeDate + durationMs < Date.now()) return true;
      }
      return false;
    }
    if (status === 'Active') return s === 'active';
    if (status === 'Paid') return s === 'paid';
    if (status === 'Unpaid') return s === 'unpaid';
    if (status === 'Revoked') return s === 'revoked';
    return true;
  };

  // Tab counts follow the search box (not the other tabs), so each number matches its tab.
  const searchedKeys = React.useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    if (!q) return keyList;
    return keyList.filter(k =>
      (k.watermarkCode || '').toUpperCase().includes(q) ||
      (k.key || '').toUpperCase().includes(q) ||
      (k.entityName || '').toUpperCase().includes(q)
    );
  }, [keyList, searchQuery]);
  const entityCount = (t: 'School' | 'Vendor' | 'Parent') => searchedKeys.filter(k => keyEntityType(k) === t).length;
  const statusCount = (st: typeof statusFilter) => searchedKeys.filter(k => keyMatchesStatus(k, st)).length;

  const tableKeys = React.useMemo(() => {
    let list = filteredKeyList;
    if (statusFilter !== 'All') {
      list = list.filter(k => keyMatchesStatus(k, statusFilter));
    }

    if (filterDate) {
      list = list.filter(k => {
        if (!k.createdAt) return false;
        const d = new Date(k.createdAt);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}` === filterDate;
      });
    }

    return list;
  }, [filteredKeyList, statusFilter, filterDate]);

  const totalPages = Math.ceil(tableKeys.length / rowsPerPage);
  const paginatedKeys = React.useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return tableKeys.slice(start, start + rowsPerPage);
  }, [tableKeys, currentPage]);

  const handleCopyAll = () => {
    const allKeys = generatedKeys.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(allKeys);
    } else {
      const ta = document.createElement("textarea");
      ta.value = allKeys;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (err) { console.error('copy failed', err); }
      document.body.removeChild(ta);
    }
    toast(`All ${generatedKeys.length} keys copied to clipboard.`, 'success');
  };

  const handleGenerateAndShowPopup = (e: React.FormEvent) => {
    handleGenerate(e);
  };

  // Show popup when new keys are generated
  React.useEffect(() => {
    if (generatedKeys.length > 0) {
      setShowGeneratedPopup(true);
      setShowKeyForm(false);
    }
  }, [generatedKeys]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto relative">
      <div className="h-10"></div>

      {/* Header — title + count chips */}
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-2xl font-bold text-foreground">Activation Keys</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="stat-chip"><Key className="w-3.5 h-3.5 text-accent-violet" /> All keys <span className="stat-chip-value">{keyList.length}</span></span>
            <span className="stat-chip"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Active <span className="stat-chip-value">{keyList.filter(k => keyMatchesStatus(k, 'Active')).length}</span></span>
            <span className="stat-chip"><CalendarX className="w-3.5 h-3.5 text-rose-500" /> Expired <span className="stat-chip-value">{keyList.filter(k => keyMatchesStatus(k, 'Expired')).length}</span></span>
            <span className="stat-chip"><Ban className="w-3.5 h-3.5 text-zinc-500" /> Revoked <span className="stat-chip-value">{keyList.filter(k => keyMatchesStatus(k, 'Revoked')).length}</span></span>
          </div>
        </div>

        {/* Filter bar — underlined tabs with counts (Product Types last); search, date, Create Key on the right. */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 w-full border-b border-sidebar-border">
          <div className="flex items-center gap-0 flex-wrap -mb-[1px]">
            <button type="button" onClick={() => { setFilterEntityType('all'); setFilterSchoolId('all'); setStatusFilter('All'); setFilterProductId('all'); }}
              className={`filter-tab ${filterEntityType === 'all' && statusFilter === 'All' && filterProductId === 'all' ? 'filter-tab-active' : ''}`}>
              All <span className="filter-tab-count">{searchedKeys.length}</span>
            </button>
            {(['School', 'Vendor', 'Parent'] as const).map(t => (
              <button key={t} type="button" onClick={() => { setFilterEntityType(t); setFilterSchoolId('all'); setStatusFilter('All'); setFilterProductId('all'); }}
                className={`filter-tab ${filterEntityType === t && statusFilter === 'All' && filterProductId === 'all' ? 'filter-tab-active' : ''}`}>
                {t} <span className="filter-tab-count">{entityCount(t)}</span>
              </button>
            ))}
            {(['Active', 'Expired', 'Paid', 'Unpaid', 'Revoked'] as const).map(st => (
              <button key={st} type="button" onClick={() => { setStatusFilter(st); setFilterEntityType('all'); setFilterSchoolId('all'); setFilterProductId('all'); }}
                className={`filter-tab ${statusFilter === st && filterEntityType === 'all' && filterProductId === 'all' ? 'filter-tab-active' : ''}`}>
                {st} <span className="filter-tab-count">{statusCount(st)}</span>
              </button>
            ))}

            <div ref={productMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductMenuOpen(!isProductMenuOpen)}
                className={`filter-tab ${filterProductId !== 'all' ? 'filter-tab-active' : ''}`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {filterProductId === 'all'
                    ? 'Product Types'
                    : productFilterOptionsFor(panel).find(o => o.value === filterProductId)?.label || 'Product Types'}
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
                        onClick={() => {
                          setFilterProductId(opt.value);
                          setFilterEntityType('all');
                          setStatusFilter('All');
                          setIsProductMenuOpen(false);
                        }}
                        className={`menu-item ${filterProductId === opt.value ? 'menu-item-active' : ''}`}
                      >
                        {opt.label === 'All Products' ? 'All Product Types' : opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full xl:w-auto mb-1">
            <div className="relative flex-1 xl:w-[240px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search key or entity…"
                className="bare-input w-full pl-8 pr-2 py-1.5 bg-transparent text-xs text-foreground placeholder-zinc-500 focus:outline-none"
              />
            </div>
            {filterDate && (
              <span className="text-[10px] font-bold text-accent-violet bg-accent-violet/10 px-2 py-1 rounded-md flex items-center gap-1 shrink-0">
                {filterDate.split('-').reverse().join('/')}
                <button type="button" onClick={() => setFilterDate('')} className="hover:text-foreground transition-colors cursor-pointer"><X className="w-3 h-3" /></button>
              </span>
            )}
            <AppleDatePicker
              value={filterDate}
              onChange={setFilterDate}
              variant="icon"
            />
            <button type="button" onClick={() => setShowKeyForm(true)} className="btn btn-secondary !h-8 !px-3 !text-xs shrink-0 whitespace-nowrap">
              <Plus className="w-3.5 h-3.5" />
              Create Key
            </button>
          </div>
        </div>
      </div>

      {/* Keys Table — Payments style */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto px-[15px] py-2.5">
          <table className="data-table data-table-rich">
            <thead>
              <tr>
                <th>Activation Key</th>
                <th>Entity Name</th>
                <th>Product</th>
                <th>Expiry</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedKeys.length > 0 ? (
                paginatedKeys.map(k => (
                  <tr key={k.id} className="group">
                    <td><span className="cell-strong cell-mono activation-token">{k.key}</span></td>
                    <td><div className="flex items-center gap-2.5"><EntityAvatar name={k.entityName || '?'} /><span>{k.entityName}</span></div></td>
                    <td><span className="cell-muted">{productWithDeviceClass(k.productId, k.deviceClass)}</span></td>
                    <td><span className="cell-muted cell-num">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('en-IN') : `${k.durationDays}d`}</span></td>
                    <td>
                      <StatusBadge status={k.status?.toLowerCase() === 'active' ? 'Active' : k.status?.toLowerCase() === 'revoked' ? 'Revoked' : k.status?.toLowerCase() === 'paid' ? 'Paid' : 'Unpaid'} />
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => handleCopy(k.key, 0)} className="icon-btn" title="Copy Key"><Copy className="w-3.5 h-3.5" /></button>
                        {k.deviceFingerprint && (
                          <button type="button" onClick={() => confirmReset(k.id, k.key)} className="icon-btn" title="Reset Device"><RotateCcw className="w-3.5 h-3.5" /></button>
                        )}
                        <button type="button" onClick={() => confirmDelete(k.id, k.key)} className="icon-btn icon-btn-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="!h-auto py-12 text-center text-zinc-500 text-sm"><AlertCircle className="w-5 h-5 mx-auto mb-2 text-zinc-600" />No activation keys found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-sidebar-border bg-sidebar">
            <div className="text-xs text-zinc-400 font-medium">
              Showing <span className="text-foreground">{((currentPage - 1) * rowsPerPage) + 1}</span> to <span className="text-foreground">{Math.min(currentPage * rowsPerPage, tableKeys.length)}</span> of <span className="text-foreground">{tableKeys.length}</span> entries
            </div>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-sidebar-border text-zinc-400 hover:text-foreground hover:bg-foreground/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-1 mx-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = i + 1;
                  if (totalPages > 5) {
                    if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all cursor-pointer ${currentPage === pageNum ? 'bg-accent-violet text-white shadow-lg' : 'text-zinc-400 hover:text-foreground hover:bg-foreground/5'}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                disabled={currentPage === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-sidebar-border text-zinc-400 hover:text-foreground hover:bg-foreground/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Key Generation Form Modal */}
      {showKeyForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-4xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={handleCancelKeyForm} className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer z-10"><X className="w-5 h-5" /></button>
            <form onSubmit={handleGenerateAndShowPopup} className="space-y-6 mt-2">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Generate Activation Keys</h2>
                <p className="text-xs text-zinc-400 mt-1">Provision high-entropy activation tokens. All keys are encrypted with AES-256 before storage.</p>
              </div>

              {/* Identity row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 block">Entity Type</label>
                  <CustomSelect required value={entityType}
                    onChange={val => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      setEntityType(val as any); setSelectedSchoolId(''); setSelectedVendorId(''); setSelectedParentId(''); setKeyManuallyEdited(false);
                    }}
                    options={[{ value: 'School', label: 'School' }, { value: 'Vendor', label: 'Vendor' }, { value: 'Individual', label: 'Normal Individual User' }]}
                    placeholder="Select Entity Type" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 block">Product</label>
                  <CustomSelect required value={productId}
                    onChange={val => { const next = val as ProductId; setProductId(next); if (targetOsFor(next) !== 'ANDROID') setDeviceClass(DEVICE_CLASS_STANDARD); }}
                    options={productsForPanel(panel).map(p => ({ value: p.id, label: p.displayName }))}
                    placeholder="Select Product" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 flex items-center gap-2"><Monitor className="w-3.5 h-3.5 text-zinc-500" /> Device Type</label>
                  {productIsAndroid ? (
                    <CustomSelect required value={deviceClass} onChange={val => setDeviceClass(val as DeviceClass)}
                      options={DEVICE_CLASS_OPTIONS.map(o => ({ value: o.value, label: o.label }))} placeholder="Select Device Type" />
                  ) : (
                    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-400">Standard — interactive-panel keys are only for Android products.</div>
                  )}
                  {productIsAndroid && deviceClass === DEVICE_CLASS_MANAGED_PANEL && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-400 block">Must be activated within (days)</label>
                      <input type="number" min={1} max={MAX_PANEL_ACTIVATION_WINDOW_DAYS} value={activateWithinDays}
                        onChange={e => setActivateWithinDays(Math.max(1, Math.min(MAX_PANEL_ACTIVATION_WINDOW_DAYS, Number(e.target.value) || 1)))}
                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-accent-violet/50" />
                    </div>
                  )}
                </div>
                {entityType === 'School' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 block">Select Institution *</label>
                    <CustomSelect required value={selectedSchoolId} onChange={val => setSelectedSchoolId(val)}
                      options={schools.map(s => ({ value: s.id, label: s.name }))} placeholder="Select School" />
                  </div>
                )}
                {entityType === 'Vendor' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 block">Select Vendor *</label>
                    <CustomSelect required value={selectedVendorId} onChange={val => setSelectedVendorId(val)}
                      options={vendors.map(v => ({ value: v.id, label: v.name }))} placeholder="Select Vendor" />
                  </div>
                )}
                {entityType === 'Individual' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 block">Select Individual *</label>
                    <CustomSelect required value={selectedParentId} onChange={val => setSelectedParentId(val)}
                      options={parents.map(p => ({ value: p.id, label: p.name }))} placeholder="Select Individual" />
                  </div>
                )}
              </div>

              {/* Policy Duration */}
              <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-4">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2"><Calendar className="w-4 h-4 text-accent-violet" /> Policy Duration</h3>
                <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
                  <button type="button" onClick={() => setDurationMode('1year')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${durationMode === '1year' ? 'bg-accent-violet text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}>1 Year</button>
                  <button type="button" onClick={() => setDurationMode('custom')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${durationMode === 'custom' ? 'bg-accent-violet text-white shadow-md' : 'text-zinc-400 hover:text-zinc-200'}`}>Custom</button>
                </div>
                {durationMode === '1year' ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-400"><Calendar className="w-3.5 h-3.5 text-accent-violet" /> Expires 365 days from activation (Valid until: {oneYearDateStr})</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div><AppleDatePicker value={customDateOnly} onChange={setCustomDateOnly} placeholder="mm/dd/yyyy" /></div>
                    <select value={customHour} onChange={e => setCustomHour(e.target.value)} className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 rounded-xl text-sm text-zinc-300 focus:outline-none appearance-none cursor-pointer">
                      {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(h => (<option key={h} value={h.padStart(2, '0')} className="bg-[#121216] text-white">{h.padStart(2, '0')} Hr</option>))}
                    </select>
                    <select value={customMinute} onChange={e => setCustomMinute(e.target.value)} className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 rounded-xl text-sm text-zinc-300 focus:outline-none appearance-none cursor-pointer">
                      {Array.from({ length: 60 }, (_, i) => String(i)).map(m => (<option key={m} value={m.padStart(2, '0')} className="bg-[#121216] text-white">{m.padStart(2, '0')} Min</option>))}
                    </select>
                    <select value={customAmpm} onChange={e => setCustomAmpm(e.target.value)} className="w-full pl-3 !pr-9 py-3 bg-[#121216]/60 border border-white/10 rounded-xl text-sm text-zinc-300 focus:outline-none appearance-none cursor-pointer">
                      <option value="AM" className="bg-[#121216] text-white">AM</option>
                      <option value="PM" className="bg-[#121216] text-white">PM</option>
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[11px] font-bold text-zinc-400"><Calendar className="w-3.5 h-3.5 text-accent-violet" /> Academic Year: <span className="text-accent-violet font-mono">{licenseAcademicYear}</span></div>
              </div>

              {/* Vendor batch mode */}
              {entityType === 'Vendor' && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-zinc-400">Key Generation Mode</span>
                  <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
                    <button type="button" onClick={() => setVendorKeyMode('single')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${vendorKeyMode === 'single' ? 'bg-accent-violet text-white shadow-md' : 'text-zinc-400'}`}>Single (1–10)</button>
                    <button type="button" onClick={() => setVendorKeyMode('batch')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${vendorKeyMode === 'batch' ? 'bg-accent-violet text-white shadow-md' : 'text-zinc-400'}`}>Batch (11–10,000)</button>
                  </div>
                </div>
              )}

              {/* Key Count & Activation Key */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 block">Key Count</label>
                  {entityType === 'Vendor' && vendorKeyMode === 'batch' ? (
                    <input type="number" min={11} max={10000} required value={batchKeyCount} onChange={e => setBatchKeyCount(e.target.value)} placeholder="e.g. 500"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm font-bold text-white placeholder-zinc-500 focus:outline-none transition-all" />
                  ) : (
                    <CustomSelect value={String(keyCount)} onChange={val => setKeyCount(Number(val))}
                      options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ value: String(n), label: `${n} ${n === 1 ? 'Key' : 'Keys'}` }))} />
                  )}
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-zinc-400 block">Activation Key Identifier</label>
                  {entityType === 'Vendor' && vendorKeyMode === 'batch' ? (
                    <div className="flex items-center px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-bold text-zinc-400">Auto-generating {batchKeyCount || 0} unique keys…</div>
                  ) : (
                    <div className="relative">
                      <input type="text" required={keyCount === 1} disabled={keyCount > 1}
                        placeholder={keyCount > 1 ? "Auto-generating keys..." : "LMS-SCHOOL-ABCDEFGHJK"}
                        value={keyCount > 1 ? "" : keyInput}
                        onChange={e => { setKeyInput(e.target.value); setKeyManuallyEdited(true); }}
                        className={`w-full pl-4 ${keyCount === 1 ? 'pr-24' : 'pr-4'} py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm font-bold text-white focus:outline-none transition-all tracking-wide font-mono disabled:opacity-50`} />
                      {keyCount === 1 && (
                        <button type="button" onClick={handleAutoSuggest} className="absolute right-3 top-3 px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer">Auto-Suggest</button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Audit banner */}
              <div className="p-4 bg-amber-500/[0.01] border border-amber-500/10 rounded-2xl flex items-start gap-3">
                <span className="p-1 rounded bg-amber-500/10 text-amber-500 mt-0.5"><ShieldAlert className="w-4 h-4" /></span>
                <p className="text-[10px] text-zinc-400 leading-relaxed"><strong className="text-zinc-200">Audit Compliance:</strong> This generation event will be logged with your UID and timestamped.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10 mt-6">
                <button type="button" onClick={handleCancelKeyForm} disabled={isPending} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={isPending} className="btn btn-primary">
                  <Lock className="w-3.5 h-3.5 inline-block mr-1" />{isPending ? 'Provisioning...' : 'Generate Keys'}
                </button>
              </div>
            </form>
          </GlassCard>
        </div>
      )}

      {/* Generated Keys Result Popup */}
      {showGeneratedPopup && generatedKeys.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-3xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowGeneratedPopup(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer z-10"><X className="w-5 h-5" /></button>
            <div className="space-y-6 mt-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-emerald-400" /> Keys Generated
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">{generatedKeys.length} activation {generatedKeys.length === 1 ? 'key' : 'keys'} provisioned successfully.</p>
                </div>
                <div className="flex items-center gap-2">
                  {generatedKeys.length > 1 && (
                    <button type="button" onClick={handleCopyAll} className="btn btn-secondary"><Copy className="w-3.5 h-3.5 inline-block mr-1" /> Copy All</button>
                  )}
                  {wasBatchGeneration && lastBatchMeta && (
                    <button type="button" onClick={() => downloadActivationKeysPdf({ entityName: lastBatchMeta.entityName, batchId: lastBatchMeta.batchId, productLabel: lastBatchMeta.productLabel, durationLabel: lastBatchMeta.durationLabel, generatedAt: new Date(), keys: generatedKeys })} className="btn btn-secondary">
                      <FileDown className="w-3.5 h-3.5 inline-block mr-1" /> PDF
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto px-[15px] py-2.5">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-sidebar-border h-[44px]">
                      <th className="px-[9px] text-[10px] font-bold text-foreground uppercase tracking-widest w-16 align-middle">#</th>
                      <th className="px-[9px] text-[10px] font-bold text-foreground uppercase tracking-widest align-middle">Activation Key</th>
                      <th className="px-[9px] text-[10px] font-bold text-foreground uppercase tracking-widest text-right align-middle">Copy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {generatedKeys.slice(0, resultsVisibleCount).map((keyVal, idx) => (
                      <tr key={keyVal} className="transition-colors group h-[44px]">
                        <td className="px-[9px] text-xs text-zinc-500 font-mono align-middle">{idx + 1}</td>
                        <td className="px-[9px] font-mono text-xs font-bold text-emerald-400 tracking-wider activation-token align-middle">{keyVal}</td>
                        <td className="px-[9px] text-right align-middle">
                          <button type="button" onClick={() => handleCopy(keyVal, idx)} className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer inline-flex">
                            {copiedKeyIndex === idx ? <span className="text-[9px] font-bold text-emerald-400">Copied!</span> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {generatedKeys.length > resultsVisibleCount && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-[11px] font-bold text-zinc-400">Showing {resultsVisibleCount} of {generatedKeys.length} keys</span>
                  <button type="button" onClick={() => setResultsVisibleCount(c => c + RESULTS_PAGE_SIZE)} className="btn btn-secondary">Show {Math.min(RESULTS_PAGE_SIZE, generatedKeys.length - resultsVisibleCount)} more</button>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-white/10">
                <button type="button" onClick={() => setShowGeneratedPopup(false)} className="btn btn-primary">Done</button>
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showConfirmModal && keyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-md p-6 space-y-6 relative">
            <button onClick={() => { setShowConfirmModal(false); setKeyToDelete(null); }} className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer"><X className="w-4 h-4" /></button>
            <div className="flex items-start gap-4">
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl"><AlertTriangle className="w-6 h-6" /></div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Confirm Key Deletion</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">Delete activation key <strong className="text-zinc-200">{keyToDelete.keyToken}</strong>?</p>
                <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-rose-400 font-semibold leading-relaxed">⚠️ This key will be permanently deleted and any bound tablet will be disconnected.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setShowConfirmModal(false); setKeyToDelete(null); }} disabled={isPending} className="btn btn-secondary">Cancel</button>
              <button onClick={handleDelete} disabled={isPending} className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-500 text-xs font-semibold text-white rounded-xl transition-all cursor-pointer disabled:opacity-55">{isPending ? 'Deleting...' : 'Confirm Delete'}</button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Reset Device Modal */}
      {showResetModal && keyToReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <GlassCard className="popup-panel animate-slide-up w-full max-w-md p-6 space-y-6 relative">
            <button onClick={() => { setShowResetModal(false); setKeyToReset(null); }} className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors cursor-pointer"><X className="w-4 h-4" /></button>
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl"><RotateCcw className="w-6 h-6" /></div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Reset Device Binding</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">Unbind key <strong className="text-zinc-200">{keyToReset.keyToken}</strong> so it can be re-activated?</p>
                <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl mt-2">
                  <p className="text-[10px] text-amber-400 font-semibold leading-relaxed">The license expiry is unchanged. The currently bound tablet will stop working until re-activation.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setShowResetModal(false); setKeyToReset(null); }} disabled={isPending} className="btn btn-secondary">Cancel</button>
              <button onClick={handleResetBinding} disabled={isPending} className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 text-xs font-semibold text-white rounded-xl transition-all cursor-pointer disabled:opacity-55">{isPending ? 'Resetting...' : 'Confirm Reset'}</button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
