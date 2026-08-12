// ============================================================================
// Product taxonomy — which client app + OS a device record originated from.
//
// Derived SERVER-SIDE ("auto-derive") from the signals each request already carries,
// so no client change is needed. Written to the `product` column on the 5
// device/product tables (see product-column.sql):
//   device_status · device_timeline · handshake_logs · terms_acceptances · activation_keys
//
// Signal availability per endpoint:
//   /api/device/ping         → os_platform, security_tier, app_version   (most precise)
//   /api/activate            → security_tier, device_os
//   /api/device/terms-accept → security_tier, device_os
//
// Accuracy note: os_platform (heartbeat only) is emitted exclusively by LMS Lab and names
// the exact platform, so device_status is authoritative. At activation/consent time there
// is no os_platform and an original "LMS android" cannot be told apart from "LMS Lab
// Android" (both send Android Keystore tiers), so those rows fall back to 'lms_android'
// and get corrected on device_status by the next heartbeat. Windows is unambiguous
// everywhere because the WIN_* tiers exist only in the LMS Lab desktop build.
// ============================================================================

export type Product =
  | 'lms_lab_android'
  | 'lms_lab_windows'
  | 'lms_lab_linux'
  | 'lms_android'
  | 'lms_windows'
  | 'unknown';

export const PRODUCTS: readonly Product[] = [
  'lms_lab_android',
  'lms_lab_windows',
  'lms_lab_linux',
  'lms_android',
  'lms_windows',
  'unknown',
] as const;

export interface ProductSignals {
  osPlatform?: string | null; // ping only: 'windows' | 'linux' | 'android' (LMS Lab)
  securityTier?: string | null; // WIN_*/DESKTOP => LMS Lab desktop; Android tiers => Android
  appVersion?: string | null; // LMS Lab: '1.0.0-android' | '1.0.0-win'
  deviceOs?: string | null; // 'Android 14' | 'Windows 10.0'
}

// Android Keystore (KeystoreCrypto) tiers — shared by original LMS Android and LMS Lab
// Android. On their own they only prove "an Android device"; the LMS Lab markers
// (os_platform / '-android' app_version, checked first) are what promote to lms_lab_android.
const ANDROID_TIERS = new Set([
  'ATTESTED_STRONGBOX',
  'ATTESTED_TEE',
  'TEE_LEGACY_NOATTEST',
  'MODEL_SKIP',
  'KEYSTORE_PLAIN',
  'SW_ONLY',
]);

export function detectProduct(s: ProductSignals): Product {
  const osp = (s.osPlatform ?? '').trim().toLowerCase();
  const tier = (s.securityTier ?? '').trim().toUpperCase();
  const ver = (s.appVersion ?? '').trim().toLowerCase();
  const dos = (s.deviceOs ?? '').trim().toLowerCase();

  // 1) os_platform is emitted ONLY by LMS Lab clients and names the exact platform —
  //    the most reliable signal (present on every heartbeat).
  if (osp === 'android') return 'lms_lab_android';
  if (osp === 'linux') return 'lms_lab_linux';
  if (osp === 'windows') return 'lms_lab_windows';

  // 2) The WIN_* / DESKTOP tiers exist only in the LMS Lab desktop (TpmSealing) build, so
  //    any of them is an LMS Lab desktop. Without os_platform (activate/terms) a native
  //    Windows host can't be told from a Linux/Wine host → default to windows.
  if (tier.startsWith('WIN_') || tier === 'DESKTOP') return 'lms_lab_windows';

  // 3) LMS Lab app_version markers (activate/terms carry no os_platform).
  if (ver.includes('-android')) return 'lms_lab_android';
  if (ver.includes('-win')) return 'lms_lab_windows';

  // 4) No LMS Lab marker → an original LMS app, classified by OS.
  if (dos.includes('android')) return 'lms_android';
  if (dos.includes('windows')) return 'lms_windows';

  // 5) Android Keystore tier with no OS hint → original LMS Android.
  if (ANDROID_TIERS.has(tier)) return 'lms_android';

  return 'unknown';
}
