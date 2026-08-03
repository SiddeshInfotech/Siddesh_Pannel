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

async function getVendorsList() {
  const { data: vendors } = await supabaseAdmin
    .from('vendors')
    .select('vendor_id, vendor_name')
    .order('vendor_name', { ascending: true });

  return (vendors ?? []).map(v => ({ id: v.vendor_id, name: v.vendor_name }));
}

async function getParentsList() {
  const { data: parents } = await supabaseAdmin
    .from('parents')
    .select('id, parent_name')
    .order('parent_name', { ascending: true });

  return (parents ?? []).map(p => ({ id: p.id, name: p.parent_name }));
}

async function getKeysList() {
  const { data: keys } = await supabaseAdmin
    .from('activation_keys')
    // NOTE: platform / security_tier are intentionally NOT selected here — they may
    // not exist until add_platform.sql / add_security_tier.sql run, and Supabase errors
    // the whole query on an unknown column. The Windows/Android badge falls back to
    // device_os (Windows OS string), so the keys page stays safe on an un-migrated DB.
    .select(`
      id, school_id, vendor_id, parent_id, key, status, duration_days, expires_at, created_at, batch_id,
      device_fingerprint, device_model, device_os, device_brand, device_android_id, activated_at,
      watermark_code,
      schools ( name ),
      vendors ( vendor_name ),
      parents ( parent_name )
    `)
    .order('created_at', { ascending: false });

  return (keys ?? []).map((k: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => {
    let entityName = 'Unknown Entity';
    if (k.schools?.name) entityName = k.schools.name;
    if (k.vendors?.vendor_name) entityName = k.vendors.vendor_name;
    if (k.parents?.parent_name) entityName = k.parents.parent_name;

    return {
      id: k.id,
      key: k.key,
      schoolId: k.school_id || '',
      vendorId: k.vendor_id || '',
      parentId: k.parent_id || '',
      entityName: entityName,
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
      platform: k.platform ?? null,
      securityTier: k.security_tier ?? null,
    };
  });
}

export default async function KeysPage() {
  const session = await getAdminSession();
  if (!session) return null;

  const [schools, keys, vendors, parents] = await Promise.all([
    getSchoolsList(),
    getKeysList(),
    getVendorsList(),
    getParentsList(),
  ]);
  return <KeysClient schools={schools} keys={keys} vendors={vendors} parents={parents} />;
}
