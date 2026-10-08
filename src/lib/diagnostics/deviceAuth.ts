// Device authentication for diagnostics uploads — same trust model as /api/device/ping:
// the (activation_key, device_fingerprint) pair must match an Active key bound to THIS device.
// School/entity identity comes from the SERVER's key row, never from the client.
import 'server-only';
import { panelDb, panelForProduct, type Panel } from '@/lib/panelTables';
import { isProductId } from '@/lib/productIdentity';

export type DeviceIdentity = { panel: Panel; keyId: string; entityId: string | null; schoolName: string | null; productId: string | null; machineId: string };

export async function authenticateDevice(activationKey: string, fingerprint: string, productId: string | undefined): Promise<DeviceIdentity | null> {
  if (!activationKey || !fingerprint || activationKey.length > 200 || fingerprint.length > 256) return null;
  const panel = panelForProduct(productId);
  const { data: key, error } = await panelDb(panel)
    .from('activation_keys')
    .select('id, status, device_fingerprint, school_id, vendor_id, parent_id, product_id, schools (name), vendors (vendor_name), parents (kid_name)')
    .eq('key', activationKey)
    .maybeSingle();
  if (error || !key || key.device_fingerprint !== fingerprint) return null;
  // Revoked/expired devices may still report crashes (that is often WHY they fail), but an
  // unbound/never-activated key may not.
  if (!['Active', 'Inactive', 'Expired', 'Revoked'].includes(key.status)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const k = key as any;
  const entityId = k.school_id ?? k.vendor_id ?? k.parent_id ?? null;
  const schoolName = k.schools?.name ?? k.vendors?.vendor_name ?? k.parents?.kid_name ?? null;
  const pinned = isProductId(k.product_id) ? k.product_id : null;
  return { panel, keyId: k.id, entityId, schoolName, productId: pinned ?? (isProductId(productId) ? productId : null), machineId: fingerprint };
}
