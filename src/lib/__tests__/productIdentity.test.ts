import { describe, expect, it } from 'vitest';
import { resolveLegacyProductId, resolveEffectiveProductId, checkProductMatch } from '../product';
import { PRODUCT_DEFINITIONS, PRODUCT_IDS, PRODUCT_FILTER_OPTIONS, DEFAULT_PRODUCT_ID } from '../productIdentity';

describe('regression: LMS School Windows must never resolve to LMS Lab Windows', () => {
  it('WIN_* tier + plain "-win" app_version (real School Windows signals) → LMS_SCHOOL_WINDOWS', () => {
    expect(
      resolveLegacyProductId({ securityTier: 'WIN_TPM_ATTESTED', appVersion: '1.0.0-win', deviceOs: 'Windows 10.0' })
    ).toBe('LMS_SCHOOL_WINDOWS');
  });

  it('WIN_SW_ONLY / WIN_TPM_NOATTEST tiers also default to School, not Lab', () => {
    expect(resolveLegacyProductId({ securityTier: 'WIN_SW_ONLY', deviceOs: 'Windows 10.0' })).toBe('LMS_SCHOOL_WINDOWS');
    expect(resolveLegacyProductId({ securityTier: 'WIN_TPM_NOATTEST', deviceOs: 'Windows 10.0' })).toBe('LMS_SCHOOL_WINDOWS');
  });

  it('a genuine LMS Lab Windows client (same tier, "-lab-win" marker) still resolves to LMS_LAB_WINDOWS', () => {
    expect(
      resolveLegacyProductId({ securityTier: 'WIN_TPM_ATTESTED', appVersion: '1.0.0-lab-win', deviceOs: 'Windows 10.0' })
    ).toBe('LMS_LAB_WINDOWS');
  });

  it('os_platform=windows (Lab-only ping signal) resolves to LMS_LAB_WINDOWS regardless of tier', () => {
    expect(resolveLegacyProductId({ osPlatform: 'windows', securityTier: 'WIN_TPM_ATTESTED' })).toBe('LMS_LAB_WINDOWS');
  });
});

describe('resolveLegacyProductId: Android and Linux (unambiguous legacy signals)', () => {
  it('Android Keystore tier + no Lab marker → LMS_SCHOOL_ANDROID', () => {
    expect(resolveLegacyProductId({ securityTier: 'ATTESTED_STRONGBOX', deviceOs: 'Android 14' })).toBe('LMS_SCHOOL_ANDROID');
  });
  it('"-lab-android" app_version marker → LMS_LAB_ANDROID', () => {
    expect(resolveLegacyProductId({ securityTier: 'ATTESTED_TEE', appVersion: '1.0.0-lab-android' })).toBe('LMS_LAB_ANDROID');
  });
  it('os_platform=linux → LMS_LAB_LINUX', () => {
    expect(resolveLegacyProductId({ osPlatform: 'linux' })).toBe('LMS_LAB_LINUX');
  });
  it('no signal at all → UNKNOWN', () => {
    expect(resolveLegacyProductId({})).toBe('UNKNOWN');
  });
});

describe('resolveEffectiveProductId: explicit client product_id is authoritative', () => {
  it('prefers an explicit valid product_id over any legacy signal, even a contradictory one', () => {
    expect(
      resolveEffectiveProductId({ productId: 'LMS_LAB_WINDOWS', securityTier: 'ATTESTED_STRONGBOX', deviceOs: 'Android 14' })
    ).toBe('LMS_LAB_WINDOWS');
  });
  it('falls back to the legacy heuristic when product_id is absent (production LMS School Android)', () => {
    expect(resolveEffectiveProductId({ securityTier: 'ATTESTED_STRONGBOX', deviceOs: 'Android 14' })).toBe('LMS_SCHOOL_ANDROID');
  });
  it('ignores an invalid/garbage product_id and falls back to the heuristic', () => {
    expect(
      resolveEffectiveProductId({ productId: 'NOT_A_REAL_PRODUCT', securityTier: 'ATTESTED_STRONGBOX', deviceOs: 'Android 14' })
    ).toBe('LMS_SCHOOL_ANDROID');
  });
});

// ── The spec's 11-row cross-product activation matrix ──────────────────────────
// Modeled as: license.product_id (pinned at Key Generation) vs the client's own
// declared product_id — exactly what checkProductMatch gates at /api/activate.
describe('activation matrix: license product vs client product', () => {
  const PASS_CASES: Array<[string, string]> = [
    ['LMS_SCHOOL_ANDROID', 'LMS_SCHOOL_ANDROID'],
    ['LMS_SCHOOL_WINDOWS', 'LMS_SCHOOL_WINDOWS'],
    ['LMS_LAB_WINDOWS', 'LMS_LAB_WINDOWS'],
    ['LMS_LAB_ANDROID', 'LMS_LAB_ANDROID'],
    ['LMS_LAB_LINUX', 'LMS_LAB_LINUX'],
  ];
  it.each(PASS_CASES)('license %s + app %s → PASS', (license, client) => {
    const result = checkProductMatch(license, client as any);
    expect(result.ok).toBe(true);
  });

  const FAIL_CASES: Array<[string, string]> = [
    ['LMS_SCHOOL_WINDOWS', 'LMS_LAB_WINDOWS'],
    ['LMS_LAB_WINDOWS', 'LMS_SCHOOL_WINDOWS'],
    ['LMS_SCHOOL_ANDROID', 'LMS_LAB_ANDROID'],
    ['LMS_LAB_ANDROID', 'LMS_SCHOOL_ANDROID'],
    ['LMS_LAB_WINDOWS', 'LMS_LAB_ANDROID'],
    ['LMS_LAB_ANDROID', 'LMS_LAB_WINDOWS'],
  ];
  it.each(FAIL_CASES)('license %s + app %s → FAIL', (license, client) => {
    const result = checkProductMatch(license, client as any);
    expect(result.ok).toBe(false);
  });

  it('a legacy key with no pinned product self-heals by pinning to the first genuine contact', () => {
    const result = checkProductMatch(null, 'LMS_SCHOOL_ANDROID');
    expect(result.ok).toBe(true);
    expect(result.ok && result.pin).toBe('LMS_SCHOOL_ANDROID');
  });

  it('a legacy key with no pinned product and an unresolvable client signal falls back to the safe default', () => {
    const result = checkProductMatch(null, 'UNKNOWN');
    expect(result.ok).toBe(true);
    expect(result.ok && result.pin).toBe(DEFAULT_PRODUCT_ID);
  });

  it('an UNKNOWN client signal against an already-pinned license is let through without re-pinning', () => {
    const result = checkProductMatch('LMS_SCHOOL_WINDOWS', 'UNKNOWN');
    expect(result.ok).toBe(true);
    expect(result.ok && result.pin).toBe(null);
  });
});

describe('monitoring consistency: same signals always resolve to the same product', () => {
  it('resolving the same signals twice (simulating activate, then ping) yields identical results', () => {
    const signals = { securityTier: 'WIN_TPM_ATTESTED', appVersion: '1.0.0-win', deviceOs: 'Windows 10.0' };
    const fromActivate = resolveLegacyProductId(signals);
    const fromPing = resolveLegacyProductId(signals);
    expect(fromActivate).toBe(fromPing);
    expect(fromActivate).toBe('LMS_SCHOOL_WINDOWS');
  });

  it('there is never a case where License=School and Device=Lab for the same explicit product_id', () => {
    for (const id of PRODUCT_IDS) {
      const resolved = resolveEffectiveProductId({ productId: id });
      expect(resolved).toBe(id);
    }
  });
});

describe('filter completeness', () => {
  it('exactly 5 canonical products exist, matching the business requirement', () => {
    expect(PRODUCT_DEFINITIONS).toHaveLength(5);
    expect(new Set(PRODUCT_IDS)).toEqual(
      new Set(['LMS_SCHOOL_ANDROID', 'LMS_SCHOOL_WINDOWS', 'LMS_LAB_ANDROID', 'LMS_LAB_WINDOWS', 'LMS_LAB_LINUX'])
    );
  });

  it('"All Products" is the first filter option and is a superset (no-op filter)', () => {
    expect(PRODUCT_FILTER_OPTIONS[0]).toEqual({ value: 'all', label: 'All Products' });
    expect(PRODUCT_FILTER_OPTIONS).toHaveLength(6); // 'all' + the 5 products
  });

  it('default product id is LMS School Android (existing production behavior)', () => {
    expect(DEFAULT_PRODUCT_ID).toBe('LMS_SCHOOL_ANDROID');
  });
});
