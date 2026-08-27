// ============================================================================
// Canonical PRODUCT identity — single source of truth for every product-aware
// surface in the panel: Key Generation, Generated Activation Credentials,
// Device Monitoring, Update & Online Sync, and the activation/ping/terms-accept
// endpoints. No component or route should hardcode its own product option list
// or its own display-name mapping — import from here instead.
//
// Stable, machine-readable IDs (never rename once shipped — they are persisted
// in the DB and compiled into client builds):
//   LMS_SCHOOL_ANDROID | LMS_SCHOOL_WINDOWS | LMS_LAB_ANDROID | LMS_LAB_WINDOWS | LMS_LAB_LINUX
//
// LMS_SCHOOL_ANDROID is the default/legacy product: every key created before
// this system existed, and every activation from a client that doesn't yet
// send an explicit product_id (the production LMS School Android app), maps
// here. See src/lib/product.ts (resolveLegacyProductId) for the fallback
// inference used when a client has no explicit product_id.
// ============================================================================

export const PRODUCT_DEFINITIONS = [
  { id: 'LMS_SCHOOL_ANDROID', displayName: 'LMS School Android', targetOs: 'ANDROID', family: 'school' },
  { id: 'LMS_SCHOOL_WINDOWS', displayName: 'LMS School Windows', targetOs: 'WINDOWS', family: 'school' },
  { id: 'LMS_LAB_ANDROID', displayName: 'LMS Lab Android', targetOs: 'ANDROID', family: 'lab' },
  { id: 'LMS_LAB_WINDOWS', displayName: 'LMS Lab Windows', targetOs: 'WINDOWS', family: 'lab' },
  { id: 'LMS_LAB_LINUX', displayName: 'LMS Lab Linux', targetOs: 'LINUX', family: 'lab' },
] as const;

export type ProductId = (typeof PRODUCT_DEFINITIONS)[number]['id'];
export type TargetOs = (typeof PRODUCT_DEFINITIONS)[number]['targetOs'];

export const PRODUCT_IDS: ProductId[] = PRODUCT_DEFINITIONS.map((p) => p.id) as ProductId[];

/** Same values, typed as a non-empty tuple — the shape zod's z.enum() requires. */
export const PRODUCT_ID_ENUM = PRODUCT_IDS as [ProductId, ...ProductId[]];

export const DEFAULT_PRODUCT_ID: ProductId = 'LMS_SCHOOL_ANDROID';

export function isProductId(value: string | null | undefined): value is ProductId {
  return !!value && (PRODUCT_IDS as string[]).includes(value);
}

export function productDisplayName(id: string | null | undefined): string {
  const def = PRODUCT_DEFINITIONS.find((p) => p.id === id);
  return def?.displayName ?? 'Unknown';
}

export function targetOsFor(id: ProductId): TargetOs {
  return PRODUCT_DEFINITIONS.find((p) => p.id === id)!.targetOs;
}

export function familyFor(id: ProductId): 'school' | 'lab' {
  return PRODUCT_DEFINITIONS.find((p) => p.id === id)!.family;
}

/** UI dropdown options, "All Products" first — used by every Product filter. */
export const PRODUCT_FILTER_OPTIONS = [
  { value: 'all', label: 'All Products' },
  ...PRODUCT_DEFINITIONS.map((p) => ({ value: p.id as string, label: p.displayName })),
];
