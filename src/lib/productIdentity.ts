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

// LMS-Lab is sold as 5 products (ThinkSphere 360 booklet), one build per product per OS.
// `labPackage` must match the app's LabPackage.kt ids. The original LMS_LAB_* ids ARE the
// Composite product ("ThinkSphere360 Lab") so already-activated devices keep working.
// family 'lab' products are managed in the Lab-Admin panel (lab_* tables), 'school' in LMS-Admin.
export const PRODUCT_DEFINITIONS = [
  { id: 'LMS_SCHOOL_ANDROID', displayName: 'LMS School Android', targetOs: 'ANDROID', family: 'school', labPackage: null },
  { id: 'LMS_SCHOOL_WINDOWS', displayName: 'LMS School Windows', targetOs: 'WINDOWS', family: 'school', labPackage: null },
  { id: 'LMS_LAB_ANDROID', displayName: 'ThinkSphere360 Lab Android', targetOs: 'ANDROID', family: 'lab', labPackage: 'composite' },
  { id: 'LMS_LAB_WINDOWS', displayName: 'ThinkSphere360 Lab Windows', targetOs: 'WINDOWS', family: 'lab', labPackage: 'composite' },
  { id: 'LMS_LAB_LINUX', displayName: 'ThinkSphere360 Lab Linux', targetOs: 'LINUX', family: 'lab', labPackage: 'composite' },
  { id: 'LAB_STEM_ANDROID', displayName: 'STEM Starter Lab Android', targetOs: 'ANDROID', family: 'lab', labPackage: 'stem' },
  { id: 'LAB_STEM_WINDOWS', displayName: 'STEM Starter Lab Windows', targetOs: 'WINDOWS', family: 'lab', labPackage: 'stem' },
  { id: 'LAB_STEM_LINUX', displayName: 'STEM Starter Lab Linux', targetOs: 'LINUX', family: 'lab', labPackage: 'stem' },
  { id: 'LAB_ROBODRONE_ANDROID', displayName: 'Robotics & Drone Lab Android', targetOs: 'ANDROID', family: 'lab', labPackage: 'robodrone' },
  { id: 'LAB_ROBODRONE_WINDOWS', displayName: 'Robotics & Drone Lab Windows', targetOs: 'WINDOWS', family: 'lab', labPackage: 'robodrone' },
  { id: 'LAB_ROBODRONE_LINUX', displayName: 'Robotics & Drone Lab Linux', targetOs: 'LINUX', family: 'lab', labPackage: 'robodrone' },
  { id: 'LAB_IOTROBO_ANDROID', displayName: 'IoT & Robotics Lab Android', targetOs: 'ANDROID', family: 'lab', labPackage: 'iotrobo' },
  { id: 'LAB_IOTROBO_WINDOWS', displayName: 'IoT & Robotics Lab Windows', targetOs: 'WINDOWS', family: 'lab', labPackage: 'iotrobo' },
  { id: 'LAB_IOTROBO_LINUX', displayName: 'IoT & Robotics Lab Linux', targetOs: 'LINUX', family: 'lab', labPackage: 'iotrobo' },
  { id: 'LAB_AIFUTURE_ANDROID', displayName: 'AI & Future Tech Lab Android', targetOs: 'ANDROID', family: 'lab', labPackage: 'aifuture' },
  { id: 'LAB_AIFUTURE_WINDOWS', displayName: 'AI & Future Tech Lab Windows', targetOs: 'WINDOWS', family: 'lab', labPackage: 'aifuture' },
  { id: 'LAB_AIFUTURE_LINUX', displayName: 'AI & Future Tech Lab Linux', targetOs: 'LINUX', family: 'lab', labPackage: 'aifuture' },
] as const;

export type LabPackage = NonNullable<(typeof PRODUCT_DEFINITIONS)[number]['labPackage']>;

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

/** The LMS-Lab product a lab product id belongs to; null for School products. */
export function labPackageFor(id: ProductId): LabPackage | null {
  return PRODUCT_DEFINITIONS.find((p) => p.id === id)!.labPackage;
}

/** Products an admin panel manages: 'lab' → Lab-Admin, 'school' → LMS-Admin. */
export function productsForFamily(family: 'school' | 'lab') {
  return PRODUCT_DEFINITIONS.filter((p) => p.family === family);
}

// Sentinel filter value for a key/device whose product never resolved (productId is null —
// e.g. never activated, or activated by a pre-product-identity legacy client). Without this
// bucket such rows were only reachable under "All Products": picking any specific product
// silently made them disappear from the list with no way to isolate or even see them.
export const UNRESOLVED_PRODUCT_FILTER_VALUE = 'unresolved';

/** UI dropdown options, "All Products" first — used by every Product filter. */
export const PRODUCT_FILTER_OPTIONS = [
  { value: 'all', label: 'All Products' },
  ...PRODUCT_DEFINITIONS.map((p) => ({ value: p.id as string, label: p.displayName })),
  { value: UNRESOLVED_PRODUCT_FILTER_VALUE, label: 'Unresolved' },
];

/** Product family an admin panel manages: Lab-Admin → 'lab', LMS-Admin → 'school'. */
export function familyForPanel(panel: 'lms' | 'lab'): 'school' | 'lab' {
  return panel === 'lab' ? 'lab' : 'school';
}

/** Default product in a panel's Key Generation form. */
export function defaultProductForPanel(panel: 'lms' | 'lab'): ProductId {
  return panel === 'lab' ? 'LMS_LAB_ANDROID' : DEFAULT_PRODUCT_ID;
}

/** Product filter dropdown for one panel: "All Products", that panel's products, "Unresolved". */
export function productFilterOptionsFor(panel: 'lms' | 'lab') {
  const family = familyForPanel(panel);
  return PRODUCT_FILTER_OPTIONS.filter(
    (o) => !isProductId(o.value) || familyFor(o.value) === family
  );
}
