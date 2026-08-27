// ============================================================================
// Product resolution — turns the signals a request carries into a canonical
// ProductId (src/lib/productIdentity.ts), and gates a license's pinned product
// against what the calling client reports.
//
// ROOT-CAUSE FIX (2026-08): the previous detectProduct() treated ANY WIN_* /
// DESKTOP security tier as proof of "LMS Lab Windows" (checked before the
// app_version marker). LMS School Windows compiles the SAME TpmSealing.jvm.kt
// module as LMS Lab Windows, so it reports the identical WIN_* tier string —
// every LMS School Windows activation was misclassified as LMS Lab Windows.
// The tier-based rule is removed entirely: a WIN_* tier proves only "a Windows
// desktop client", never which product. Family is now decided by (in order)
// an explicit client-declared product_id, the Lab-only os_platform ping
// signal, or an EXACT '-lab-<os>' app_version marker — never a bare '-win'
// substring (which would still catch School's own "1.0.0-win").
// ============================================================================

import { PRODUCT_IDS, DEFAULT_PRODUCT_ID, ProductId, isProductId } from './productIdentity';

export interface ProductSignals {
  productId?: string | null; // NEW: explicit, client-declared canonical product id (authoritative if valid)
  osPlatform?: string | null; // ping only: 'windows' | 'linux' | 'android' (LMS Lab)
  securityTier?: string | null; // advisory posture tag; NOT a product signal (WIN_* is shared by School & Lab)
  appVersion?: string | null; // LMS Lab: '1.0.0-lab-android' | '1.0.0-lab-linux' | '1.0.0-lab-win'
  deviceOs?: string | null; // 'Android 14' | 'Windows 10.0'
}

// Android Keystore (KeystoreCrypto) tiers — shared by original LMS Android and LMS Lab
// Android. On their own they only prove "an Android device"; the LMS Lab markers
// (os_platform / '-lab-android' app_version, checked first) are what promote to LMS_LAB_ANDROID.
const ANDROID_TIERS = new Set([
  'ATTESTED_STRONGBOX',
  'ATTESTED_TEE',
  'TEE_LEGACY_NOATTEST',
  'MODEL_SKIP',
  'KEYSTORE_PLAIN',
  'SW_ONLY',
]);

/**
 * Resolves the canonical ProductId for a request that carries no (or an
 * invalid) explicit product_id — i.e. legacy/unmigrated clients. Newer clients
 * should send product_id directly; see resolveEffectiveProductId below, which
 * prefers that over this heuristic.
 */
export function resolveLegacyProductId(s: ProductSignals): ProductId | 'UNKNOWN' {
  const osp = (s.osPlatform ?? '').trim().toLowerCase();
  const tier = (s.securityTier ?? '').trim().toUpperCase();
  const ver = (s.appVersion ?? '').trim().toLowerCase();
  const dos = (s.deviceOs ?? '').trim().toLowerCase();

  // 1) os_platform is emitted ONLY by LMS Lab clients and names the exact platform —
  //    the most reliable legacy signal (present on every Lab heartbeat).
  if (osp === 'android') return 'LMS_LAB_ANDROID';
  if (osp === 'linux') return 'LMS_LAB_LINUX';
  if (osp === 'windows') return 'LMS_LAB_WINDOWS';

  // 2) LMS Lab app_version markers — EXACT '-lab-<os>' substrings only. A bare '-win'
  //    (e.g. School's own "1.0.0-win") must never match here; that was the secondary,
  //    latent bug behind the WIN_* misclassification.
  if (ver.includes('lab-android')) return 'LMS_LAB_ANDROID';
  if (ver.includes('lab-linux')) return 'LMS_LAB_LINUX';
  if (ver.includes('lab-win')) return 'LMS_LAB_WINDOWS';

  // 3) No LMS Lab marker → an LMS School app, classified by OS. NOTE: the security_tier
  //    (WIN_*/DESKTOP/Android Keystore tiers) is deliberately NOT consulted for product
  //    family here — it is shared across School and Lab and proves nothing about which
  //    one this is. Windows with no Lab marker defaults to School (matches "existing
  //    legacy credentials map to LMS_SCHOOL_* unless proven otherwise").
  if (dos.includes('android')) return 'LMS_SCHOOL_ANDROID';
  if (dos.includes('windows')) return 'LMS_SCHOOL_WINDOWS';

  // 4) Android Keystore tier with no OS hint → original LMS School Android.
  if (ANDROID_TIERS.has(tier)) return 'LMS_SCHOOL_ANDROID';

  return 'UNKNOWN';
}

/**
 * The single entry point every device-facing route should call: prefers an
 * explicit, valid client-declared product_id; falls back to the legacy
 * heuristic for clients that don't send one yet (e.g. production LMS School
 * Android, and any not-yet-rebuilt Windows/Lab client).
 */
export function resolveEffectiveProductId(s: ProductSignals): ProductId | 'UNKNOWN' {
  if (isProductId(s.productId)) return s.productId;
  return resolveLegacyProductId(s);
}

/**
 * The activation/heartbeat product-identity gate. A license with no pinned
 * product yet (legacy key, or a brand-new key that predates this system)
 * self-heals by pinning to whatever the first genuine contact resolves to —
 * matching this project's existing "self-heal instead of Blocked/Expired"
 * philosophy. A license that IS already pinned must match exactly, or the
 * request is rejected.
 */
export function checkProductMatch(
  pinnedProductId: string | null | undefined,
  clientProductId: ProductId | 'UNKNOWN'
): { ok: true; pin: ProductId | null } | { ok: false; reason: string } {
  if (isProductId(pinnedProductId)) {
    if (clientProductId === 'UNKNOWN' || clientProductId === pinnedProductId) {
      // An UNKNOWN client signal against an already-pinned license is allowed through
      // (can't prove a mismatch) but does NOT re-pin — the license's product stays authoritative.
      return { ok: true, pin: null };
    }
    return {
      ok: false,
      reason: `Product mismatch: this activation key is licensed for a different product.`,
    };
  }
  // Not yet pinned: pin to the resolved product (or the safe default if truly unresolvable).
  const pin = clientProductId === 'UNKNOWN' ? DEFAULT_PRODUCT_ID : clientProductId;
  return { ok: true, pin };
}

export { PRODUCT_IDS };
export type { ProductId };
