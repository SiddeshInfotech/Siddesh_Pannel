import React from 'react';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import MonitoringClient from './MonitoringClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

async function getDevicesData() {
  const { data: keys } = await supabaseAdmin
    .from('activation_keys')
    .select(`
      id, key, status, duration_days, expires_at, activated_at, last_known_monotonic_time,
      device_fingerprint, device_model, device_os, device_board, device_brand,
      device_device, device_manufacturer, device_android_id, security_tier,
      schools (
        id, name, school_id, board, mediums, academic_year, section, standard,
        full_class_name, coordinator_name, email, phone
      )
    `)
    .not('device_fingerprint', 'is', null)
    .neq('device_fingerprint', '')
    .order('activated_at', { ascending: false });

  return (keys ?? []).map((k: any) => {
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
        ? new Date(k.activated_at).toLocaleDateString('en-IN')
        : 'N/A',
      exactActivationDate: k.activated_at
        ? new Date(k.activated_at).toLocaleString('en-IN', {
            dateStyle: 'long',
            timeStyle: 'medium',
          })
        : 'N/A',
      lastSync: k.last_known_monotonic_time
        ? new Date(k.last_known_monotonic_time).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Just now',
      exactLastSync: k.last_known_monotonic_time
        ? new Date(k.last_known_monotonic_time).toLocaleString('en-IN', {
            dateStyle: 'long',
            timeStyle: 'medium',
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
