import { targetOsFor, type ProductId } from '@/lib/productIdentity';

// ============================================================================
// Device class of an activation key — chosen by the operator at Key Generation, stored in
// activation_keys.device_class (scripts/add_device_class.sql).
//
//   NULL / 'standard'  Phones & tablets. Full security, exactly as before this existed.
//   'managed_panel'    Interactive classroom panels (any brand / model / Android version).
//                      /api/activate treats a failed hardware attestation as audit-only for
//                      an Android device activating THIS key, and signs
//                      `device_class: "managed_panel"` into its licence, which the Android
//                      client reads to tolerate the panel ROM's system `su` binary at
//                      video-key release (emulator / debugger / hook checks still apply).
//
// The trust anchor is the KEY — a one-time, server-issued credential — not anything the device
// reports about itself (model / OS strings are trivially spoofable). Android products only.
// ============================================================================

export const DEVICE_CLASS_STANDARD = 'standard' as const;
export const DEVICE_CLASS_MANAGED_PANEL = 'managed_panel' as const;

export const DEVICE_CLASS_ENUM = [DEVICE_CLASS_STANDARD, DEVICE_CLASS_MANAGED_PANEL] as const;
export type DeviceClass = (typeof DEVICE_CLASS_ENUM)[number];

export const DEVICE_CLASS_OPTIONS: ReadonlyArray<{ value: DeviceClass; label: string }> = [
  { value: DEVICE_CLASS_STANDARD, label: 'Standard (phone / tablet)' },
  { value: DEVICE_CLASS_MANAGED_PANEL, label: 'Interactive panel' },
];

export function deviceClassLabel(value: string | null | undefined): string {
  return value === DEVICE_CLASS_MANAGED_PANEL ? 'Interactive panel' : 'Standard';
}

/** Interactive-panel keys only exist for Android products (panels run Android). */
export function deviceClassAllowedFor(productId: ProductId, deviceClass: DeviceClass): boolean {
  return deviceClass === DEVICE_CLASS_STANDARD || targetOsFor(productId) === 'ANDROID';
}

/** True only for a key row explicitly generated/marked as an interactive panel key. */
export function isPanelKey(row: { device_class?: string | null } | null | undefined): boolean {
  return row?.device_class === DEVICE_CLASS_MANAGED_PANEL;
}

/** Postgres/PostgREST "column does not exist" — the migration hasn't been run yet. */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /device_class/i.test(error.message ?? '');
}
