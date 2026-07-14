import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import KeysClient from './KeysClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getSchoolsList() {
  const { data: schools } = await supabaseAdmin
    .from('schools')
    .select('id, name')
    .order('name', { ascending: true });

  return (schools ?? []).map(s => ({ id: s.id, name: s.name }));
}

async function getKeysList() {
  const { data: keys } = await supabaseAdmin
    .from('activation_keys')
    .select(`
      id, key, status, duration_days, expires_at, created_at, batch_id,
      device_fingerprint, device_model, device_os, device_brand, device_android_id, activated_at,
      watermark_code,
      schools ( name )
    `)
    .order('created_at', { ascending: false });

  return (keys ?? []).map((k: any) => ({
    id: k.id,
    key: k.key,
    schoolName: k.schools?.name || 'Unknown School',
    status: k.status || 'Unpaid',
    durationDays: k.duration_days || 365,
    expiresAt: k.expires_at ?? null,
    createdAt: k.created_at ? new Date(k.created_at).toLocaleDateString('en-IN') : 'N/A',
    batchId: k.batch_id ?? null,
    deviceFingerprint: k.device_fingerprint ?? null,
    deviceModel: k.device_model ?? null,
    deviceOS: k.device_os ?? null,
    deviceBrand: k.device_brand ?? null,
    deviceAndroidId: k.device_android_id ?? null,
    activatedAt: k.activated_at ? new Date(k.activated_at).toLocaleDateString('en-IN') : null,
    watermarkCode: k.watermark_code ?? null,
  }));
}

export default async function KeysPage() {
  const session = await getAdminSession();
  if (!session) return null;

  // Direct fetch (page is force-dynamic): avoids the Next 16 unstable_cache
  // failure that 500'd this page in production.
  const [schools, keys] = await Promise.all([getSchoolsList(), getKeysList()]);
  return <KeysClient schools={schools} keys={keys} />;
}
