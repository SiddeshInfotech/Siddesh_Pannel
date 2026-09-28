'use server';

import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { adminDb } from '@/lib/panelTables';

export async function getHandshakeLogs(page: number = 1, limit: number = 10, searchQuery: string = '') {
  const session = await getAdminSession();
  if (!session) throw new Error('Unauthorized: Admin access required');

  const skip = (page - 1) * limit;

  let query = (await adminDb())
    .from('handshake_logs')
    .select('*', { count: 'exact' });

  if (searchQuery) {
    query = query.ilike('activation_key', `%${searchQuery}%`);
  }

  const { data: logs, count, error } = await query
    .order('timestamp', { ascending: false })
    .range(skip, skip + limit - 1);

  if (error) {
    logger.error({ event: 'GET_HANDSHAKE_LOGS_DB_ERROR', page, limit }, error);
    return { logs: [], totalCount: 0, totalPages: 0, currentPage: page };
  }

  const totalCount = count ?? 0;

  return {
    logs: (logs ?? []).map(log => ({
      id: log.id,
      activationKey: log.activation_key,
      deviceFingerprint: log.device_fingerprint,
      deviceModel: log.device_model || 'Unknown Tablet',
      deviceOS: log.device_os || 'Android',
      status: log.status,
      errorMessage: log.error_message || '',
      ipAddress: log.ip_address || '127.0.0.1',
      time: log.timestamp || 'Just now',
    })),
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
}

export async function getLiveSchoolsFeed() {
  const session = await getAdminSession();
  if (!session) throw new Error('Unauthorized: Admin access required');

  const { data: schools, error } = await (await adminDb())
    .from('schools')
    .select('id, name, city, state, created_at, status')
    .eq('status', 'Active')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    logger.error({ event: 'GET_LIVE_SCHOOLS_FEED_ERROR' }, error);
    return [];
  }

  return (schools ?? []).map(school => ({
    id: school.id,
    school: school.name,
    details: `${school.city || ''}, ${school.state || ''}`,
    time: school.created_at || 'Recently',
    status: school.status,
  }));
}

export async function getDashboardMetrics() {
  const session = await getAdminSession();
  if (!session) throw new Error('Unauthorized: Admin access required');

  const [schoolsResult, keysResult, paymentsResult] = await Promise.all([
    (await adminDb()).from('schools').select('*', { count: 'exact', head: true }),
    (await adminDb()).from('activation_keys').select('*', { count: 'exact', head: true }).eq('status', 'Active'),
    (await adminDb()).from('payments').select('*', { count: 'exact', head: true }).eq('status', 'Pending Approval')
  ]);

  return {
    totalSchools: schoolsResult.count ?? 0,
    activeKeys: keysResult.count ?? 0,
    pendingPayments: paymentsResult.count ?? 0
  };
}
