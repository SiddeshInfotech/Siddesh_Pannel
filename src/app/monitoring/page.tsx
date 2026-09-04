import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import MonitoringClient from './MonitoringClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// All device/consent timestamps are rendered in India Standard Time. The server
// (Vercel) runs in UTC, so toLocale* WITHOUT this option would show times 5h30m
// behind the wall clock of an Indian admin. This is an India-only deployment.
const IST = 'Asia/Kolkata';

// security_tier is a NEW column (scripts/add_security_tier.sql). Select it, but if the
// migration hasn't run yet, PostgREST 400s the whole query — which would blank the entire
// device list. So on error we retry WITHOUT the column: the dashboard keeps working and
// tiers just render as "Unreported" until the migration is applied. Push order-independent.
const SCHOOL_COLS = `schools (
        id, name, school_id, board, mediums, academic_year, section, standard,
        full_class_name, coordinator_name, email, phone
      )`;
// Vendor + Parent embeds — a device belongs to exactly one entity. Vendor rows show the
// vendor (this is the ADMIN's own dashboard, so the full name is fine here — the privacy
// limit only applies to what the vendor's own APP receives). Parent rows show the student.
const VENDOR_COLS = `vendors (
        vendor_id, vendor_name, vendor_code, business_category, standard, academic_year, city, state, email_address, mobile_number
      )`;
const PARENT_COLS = `parents (
        id, parent_id, parent_name, kid_name, grade, city, state, email, phone_number
      )`;
const KEY_COLS_BASE = `id, key, status, duration_days, expires_at, activated_at, last_known_monotonic_time,
      school_id, vendor_id, parent_id,
      device_fingerprint, device_model, device_os, device_board, device_brand,
      device_device, device_manufacturer, device_android_id`;

async function fetchActivatedKeys(includeTier: boolean) {
  // attestation_verified_tier (scripts/add_attestation_verified_tier.sql) is the
  // SERVER-DERIVED, trusted tier — security_tier is the client's own untrusted
  // self-report. Selected together since they're expected to migrate together; if
  // either column is missing, PostgREST 400s the whole query and the caller retries
  // without both, same graceful-degradation as before.
  const sel = includeTier
    ? `${KEY_COLS_BASE}, security_tier, attestation_verified_tier, product, product_id, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`
    : `${KEY_COLS_BASE}, ${SCHOOL_COLS}, ${VENDOR_COLS}, ${PARENT_COLS}`;
  return supabaseAdmin
    .from('activation_keys')
    .select(sel)
    .not('device_fingerprint', 'is', null)
    .neq('device_fingerprint', '')
    .order('activated_at', { ascending: false });
}

// Pre-activation consent records, keyed by device fingerprint. Best-effort: if the
// terms_acceptances table isn't migrated yet (scripts/add_terms_acceptances.sql),
// PostgREST 400s — we swallow it and every device just shows "Not recorded".
async function fetchTermsAcceptances(fingerprints: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (fingerprints.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('terms_acceptances')
    .select('device_fingerprint, terms_version, accepted_at')
    .in('device_fingerprint', fingerprints);
  if (error) return map;
  for (const row of data ?? []) map.set(row.device_fingerprint, row);
  return map;
}

// Server-side expiry-tamper flags, keyed by activation-key id. Best-effort + isolated: if the
// expiry_tamper columns aren't migrated yet (scripts/add_expiry_tamper.sql), PostgREST 400s and
// every key just shows "no tamper" — the device list is never blanked by a missing column.
async function fetchTamperFlags(keyIds: string[]): Promise<Map<string, { flag: boolean; at: string | null; detail: unknown }>> {
  const map = new Map<string, { flag: boolean; at: string | null; detail: unknown }>();
  if (keyIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('activation_keys')
    .select('id, expiry_tamper_flag, expiry_tamper_at, expiry_tamper_detail')
    .in('id', keyIds);
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.id, { flag: row.expiry_tamper_flag === true, at: row.expiry_tamper_at ?? null, detail: row.expiry_tamper_detail ?? null });
  }
  return map;
}

// Most recent genuine attestation SECURITY problem per device, keyed by fingerprint
// (ATTESTATION_ISSUE only — ATTESTATION_HEALTH_WARNING, e.g. TEMPORARY_ERROR, is a
// distinct, deliberately non-alarming event type, never surfaced as a security issue
// here — see attestationTelemetry.ts). Best-effort + isolated: a query error or empty
// result just means every device shows no issue, never blanks the device list. Rows
// are deduplicated server-side (same device + reason code within 15 min updates one
// row's count instead of appending), so this is already bounded, not raw event volume.
type AttestationIssue = {
  tier: string;
  reasonCode: string;
  reasonDetail: string;
  count: number;
  enforced: boolean;
  action: string;
  at: string;
};
async function fetchAttestationIssues(fingerprints: string[]): Promise<Map<string, AttestationIssue>> {
  const map = new Map<string, AttestationIssue>();
  if (fingerprints.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('device_timeline')
    .select('device_fingerprint, detail, created_at')
    .eq('event_type', 'ATTESTATION_ISSUE')
    .in('device_fingerprint', fingerprints)
    .order('created_at', { ascending: false });
  if (error) return map;
  for (const row of data ?? []) {
    // Rows arrive newest-first; keep only the first (= most recent) per fingerprint.
    if (map.has(row.device_fingerprint)) continue;
    const d = (row.detail ?? {}) as Record<string, unknown>;
    map.set(row.device_fingerprint, {
      tier: typeof d.tier === 'string' ? d.tier : 'UNKNOWN',
      reasonCode: typeof d.reason_code === 'string' ? d.reason_code : 'UNKNOWN',
      reasonDetail: typeof d.reason_detail === 'string' ? d.reason_detail : 'unknown',
      count: typeof d.count === 'number' ? d.count : 1,
      enforced: d.enforced === true,
      action: typeof d.action === 'string' ? d.action : 'UNKNOWN',
      at: typeof d.last_seen_at === 'string' ? d.last_seen_at : row.created_at,
    });
  }
  return map;
}

async function getDevicesData() {
  let { data: keys, error } = await fetchActivatedKeys(true);
  if (error) {
    // Most likely the security_tier column isn't migrated yet — fall back gracefully.
    ({ data: keys } = await fetchActivatedKeys(false));
  }

  const fingerprints = (keys ?? [])
    .map((k: any) => k.device_fingerprint)
    .filter((f: any): f is string => !!f);
  const termsByFp = await fetchTermsAcceptances(fingerprints);
  const tamperById = await fetchTamperFlags(
    ((keys ?? []) as unknown as Array<{ id: string }>).map((k) => k.id).filter((id) => !!id)
  );
  const attestationIssueByFp = await fetchAttestationIssues(fingerprints);

  return (keys ?? []).map((k: any ) => {
    const terms = k.device_fingerprint ? termsByFp.get(k.device_fingerprint) : undefined;
    const tamper = tamperById.get(k.id);
    const attestationIssue = k.device_fingerprint ? attestationIssueByFp.get(k.device_fingerprint) ?? null : null;
    // Calculate remaining time
    let remainingTime = 'N/A';
    if (k.expires_at) {
      const diffTime = new Date(k.expires_at).getTime() - new Date().getTime();
      if (diffTime <= 0) {
        remainingTime = 'Expired';
      } else {
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMins = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
        if (diffDays > 0) remainingTime = `${diffDays}d ${diffHours}h left`;
        else if (diffHours > 0) remainingTime = `${diffHours}h ${diffMins}m left`;
        else remainingTime = `${diffMins}m left`;
      }
    }
    if (k.status === 'Revoked') remainingTime = 'Deactivated';

    let status = k.status;
    if (remainingTime === 'Expired' && status === 'Active') status = 'Inactive';

    const school = k.schools;
    const vendor = k.vendors;
    const parent = k.parents;

    // Which entity owns this device (exactly one id is set). Drives the monitoring
    // filter (Schools / Vendors / Users) and what the row + detail panel show.
    let entityType: 'school' | 'vendor' | 'student' = 'school';
    let entityName = school?.name || 'Unknown School';
    if (k.vendor_id) {
      entityType = 'vendor';
      entityName = vendor?.vendor_name || vendor?.vendor_id || 'Unknown Vendor';
    } else if (k.parent_id) {
      entityType = 'student';
      entityName = parent?.kid_name || parent?.parent_name || 'Unknown Student';
    }

    return {
      entityType,
      entityName,
      // Vendor detail (admin view).
      vendorId: vendor?.vendor_id || k.vendor_id || 'N/A',
      vendorCode: vendor?.vendor_code || 'N/A',
      vendorCategory: vendor?.business_category || 'N/A',
      vendorCity: vendor?.city || 'N/A',
      vendorState: vendor?.state || 'N/A',
      vendorEmail: vendor?.email_address || 'N/A',
      vendorPhone: vendor?.mobile_number || 'N/A',
      vendorYear: vendor?.academic_year || 'N/A',
      // Student / parent detail (admin view).
      studentName: parent?.kid_name || 'N/A',
      studentGrade: parent?.grade || 'N/A',
      parentName: parent?.parent_name || 'N/A',
      parentEmail: parent?.email || 'N/A',
      parentPhone: parent?.phone_number || 'N/A',
      parentCity: parent?.city || 'N/A',
      parentState: parent?.state || 'N/A',
      id: k.id,
      model: k.device_model || 'Unknown Device',
      os: k.device_os || 'Unknown OS',
      fingerprint: k.device_fingerprint || 'N/A',
      board: k.device_board || 'N/A',
      brand: k.device_brand || 'N/A',
      device: k.device_device || 'N/A',
      manufacturer: k.device_manufacturer || 'N/A',
      androidId: k.device_android_id || 'N/A',
      securityTier: k.security_tier || 'UNREPORTED',
      // Server-derived, trusted tier (attestationPolicy.deriveServerTier) — this, not
      // securityTier above, is what should drive an operator's actual trust judgement.
      verifiedTier: k.attestation_verified_tier || 'UNSUPPORTED',
      // Most recent GENUINE attestation problem (never the routine no-hardware case —
      // see fetchAttestationIssues). null = no known issue for this device.
      attestationIssue,
      // Canonical product_id (src/lib/productIdentity.ts) wins when a device has reported
      // one; older rows/clients that predate that column fall back to the auto-detected
      // `product` column (src/lib/product.ts) so they don't regress to "Unknown".
      product: k.product_id || k.product || null,
      activationDate: k.activated_at
        ? new Date(k.activated_at).toLocaleDateString('en-IN', { timeZone: IST })
        : 'N/A',
      exactActivationDate: k.activated_at
        ? new Date(k.activated_at).toLocaleString('en-IN', {
            dateStyle: 'long',
            timeStyle: 'medium',
            timeZone: IST,
          })
        : 'N/A',
      lastSync: k.last_known_monotonic_time
        ? new Date(k.last_known_monotonic_time).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: IST,
          })
        : 'Just now',
      exactLastSync: k.last_known_monotonic_time
        ? new Date(k.last_known_monotonic_time).toLocaleString('en-IN', {
            dateStyle: 'long',
            timeStyle: 'medium',
            timeZone: IST,
          })
        : 'Just now',
      remainingTime,
      expiresAt: k.expires_at ?? null,
      status,
      schoolName: school?.name || 'Unknown School',
      schoolCustomId: school?.school_id || 'N/A',
      schoolBoard: school?.board || 'N/A',
      schoolMediums: school?.mediums ? school.mediums.join(', ') : 'N/A',
      schoolStandard: school?.standard || 'N/A',
      schoolSection: school?.section || 'N/A',
      schoolClassName: school?.full_class_name || 'N/A',
      schoolAcademicYear: school?.academic_year || 'N/A',
      schoolCoordinator: school?.coordinator_name || 'N/A',
      schoolEmail: school?.email || 'N/A',
      schoolPhone: school?.phone || 'N/A',
      licenseKey: k.key,
      durationDays: k.duration_days || 365,
      // Pre-activation consent (Privacy Policy + Terms & Conditions).
      termsAccepted: !!terms,
      termsVersion: terms?.terms_version || null,
      termsAcceptedAt: terms?.accepted_at
        ? new Date(terms.accepted_at).toLocaleString('en-IN', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: IST,
          })
        : null,
      // Server-side expiry-tamper: true once this key reported an expiry later than signed.
      expiryTamper: tamper?.flag === true,
      expiryTamperAt: tamper?.at
        ? new Date(tamper.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST })
        : null,
      expiryTamperDetail: tamper?.detail ?? null,
    };
  });
}

export default async function MonitoringPage() {
  const session = await getAdminSession();
  if (!session) return null;

  // Direct fetch (page is force-dynamic): avoids the Next 16 unstable_cache
  // failure that 500'd this page in production.
  const devices = await getDevicesData();
  const totalCount = devices.filter(d => d.status === 'Active').length;
  return <MonitoringClient initialDevices={devices} totalDevicesCount={totalCount} />;
}
