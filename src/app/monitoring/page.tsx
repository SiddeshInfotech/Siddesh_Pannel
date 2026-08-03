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
const KEY_COLS_BASE = `id, key, status, duration_days, expires_at, activated_at, last_known_monotonic_time,
      device_fingerprint, device_model, device_os, device_board, device_brand,
      device_device, device_manufacturer, device_android_id`;

async function fetchActivatedKeys(includeTier: boolean) {
  const sel = includeTier
    ? `${KEY_COLS_BASE}, security_tier, ${SCHOOL_COLS}`
    : `${KEY_COLS_BASE}, ${SCHOOL_COLS}`;
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

  return (keys ?? []).map((k: any ) => {
    const terms = k.device_fingerprint ? termsByFp.get(k.device_fingerprint) : undefined;

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

    return {
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
