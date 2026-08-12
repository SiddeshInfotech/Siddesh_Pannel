// ============================================================================
// Multi-entity activation chain — School | Vendor | Parent(Individual)
//
// A single activation_keys row is owned by EXACTLY ONE entity (school_id OR
// vendor_id OR parent_id is set; see support-multi-entity-payments.sql). Every
// place that used to assume "school" — the /api/activate license payload, the
// content-key entitlement, /api/device/ping telemetry, and the monitoring join —
// now routes through this module so Vendor and Parent keys behave with FULL
// PARITY to a school.
//
// PRIVACY: the license payload the device receives is entity-appropriate:
//   • school  → full school info (name/board/mediums/standard/…) — unchanged.
//   • vendor  → GENERIC only: vendor_id + year + a generic label. No PII, no
//               vendor name/contact — nothing that fixes the install to a real org.
//   • student → the STUDENT: kid name + grade (+ parent name), so the app's
//               Information tab can show "who this license belongs to".
// The `entity_type` field lets each client app render the right Information tab.
// Legacy fields (school_name / standard / fullClassName / academicYear) are ALSO
// populated with sensible generic values so OLDER app builds still render.
// ============================================================================

import { supabaseAdmin } from '@/lib/supabase';

export type EntityType = 'school' | 'vendor' | 'student';

// Content exists ONLY for these classes. Entitlement is always the intersection of
// what an entity is scoped to with this set. MUST stay in sync with /api/activate's
// SUBJECTS loop and the app's scope ids.
export const CONTENT_CLASS_NUMBERS = [1, 2, 3, 4] as const;

const ALL_CLASS_IDS = CONTENT_CLASS_NUMBERS.map((n) => `class_${n}`);

export interface EntityRef {
  type: EntityType;
  schoolId: string | null;
  vendorId: string | null;
  parentId: string | null;
}

/** Which entity owns this key/payment row (exactly one of the three ids is set). */
export function entityRefFromRow(row: {
  school_id?: string | null;
  vendor_id?: string | null;
  parent_id?: string | null;
}): EntityRef {
  if (row.vendor_id) return { type: 'vendor', schoolId: null, vendorId: row.vendor_id, parentId: null };
  if (row.parent_id) return { type: 'student', schoolId: null, vendorId: null, parentId: row.parent_id };
  return { type: 'school', schoolId: row.school_id ?? null, vendorId: null, parentId: null };
}

// V-07: resolve curriculum class id(s) from a purchased GRADE SCOPE string — either a
// range ("1st to 4th", "1st to 10th") or a single grade ("Grade 2"). Extract its
// integers and intersect with the classes that actually have content (1-4):
//   • two numbers -> inclusive range [min..max] ∩ {1..4}
//   • one number  -> that single grade if it is in {1..4}
// FAIL CLOSED: no in-range entitlement ⇒ [] (device gets NO content keys). We NEVER
// fall back to "all classes" here — that was the original leak. (Vendor's "all"
// default is applied explicitly in resolveEntity, not hidden inside this parser.)
export function classIdsFromScope(scope: string | null | undefined): string[] {
  const nums = (String(scope ?? '').match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);
  let entitled: number[];
  if (nums.length >= 2) {
    const lo = Math.min(nums[0], nums[1]);
    const hi = Math.max(nums[0], nums[1]);
    entitled = CONTENT_CLASS_NUMBERS.filter((n) => n >= lo && n <= hi);
  } else if (nums.length === 1) {
    entitled = CONTENT_CLASS_NUMBERS.filter((n) => n === nums[0]);
  } else {
    entitled = [];
  }
  return entitled.map((n) => `class_${n}`);
}

// School-specific entitlement, preserving the original precedence: an explicit operator
// override on the school record wins, otherwise parse the controlled grade-scope field.
function schoolClassIds(school: Record<string, unknown> | null): string[] {
  const explicit = (school?.class_id ?? school?.curriculum_class ?? school?.class) as unknown;
  const explicitNums = explicit
    ? (String(explicit).match(/\d+/g) ?? []).map(Number).filter((n) => (CONTENT_CLASS_NUMBERS as readonly number[]).includes(n))
    : [];
  if (explicitNums.length) {
    return [...new Set(explicitNums)].sort((a, b) => a - b).map((n) => `class_${n}`);
  }
  return classIdsFromScope(school?.standard as string | undefined);
}

/** Extract a 4-digit year from a vendor id like "VND-2026-1234". */
function yearFromVendorId(vendorId: string | null | undefined): string | null {
  const m = String(vendorId ?? '').match(/\b(20\d{2})\b/);
  return m ? m[1] : null;
}

// Indian academic year (runs Apr–Mar) for a date, e.g. 2026-08-12 → "2026-27".
// Persisted on each activation key at GENERATION time (the admin picks the key's
// duration/validity there), then served back as the entity's "year" at activation —
// so the year the operator chose is what the device shows and we keep on record.
export function indianAcademicYear(d: Date = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1; // months are 0-based
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const CURRENT_ACADEMIC_YEAR = indianAcademicYear();

export interface ResolvedEntity {
  entityType: EntityType;
  /** Human label for logs / monitoring (real name; NOT necessarily sent to the device). */
  entityName: string;
  /** Content classes this entity is entitled to (e.g. ['class_1','class_2']). */
  classIds: string[];
  /** Entity-specific portion of the license payload the device receives. */
  license: Record<string, unknown>;
}

// Fetch the owning entity and build (a) its content entitlement and (b) the
// entity-specific license fields. Never throws — a missing row degrades to a safe,
// generic payload with no content keys (fail-closed), and the caller logs it.
export async function resolveEntity(
  ref: EntityRef,
  opts?: { keyAcademicYear?: string | null }
): Promise<ResolvedEntity> {
  // Year stored on THIS key at generation (operator's chosen validity year) wins.
  const keyYear = opts?.keyAcademicYear || null;
  if (ref.type === 'vendor') {
    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('vendor_id, vendor_name, standard, academic_year')
      .eq('vendor_id', ref.vendorId)
      .single();

    const vendorId = vendor?.vendor_id ?? ref.vendorId ?? 'UNKNOWN';
    // Priority: the key's generation-time academic year → vendor override → year in the
    // vendor id → current academic year.
    const year =
      keyYear ||
      (vendor?.academic_year as string | undefined) ||
      yearFromVendorId(vendorId) ||
      CURRENT_ACADEMIC_YEAR;
    // Vendor content parity with a school: scoped by `standard` if the operator set
    // one, else the FULL content set (a vendor is a reseller/showcase install).
    const classIds = vendor?.standard ? classIdsFromScope(vendor.standard as string) : [...ALL_CLASS_IDS];

    return {
      entityType: 'vendor',
      entityName: (vendor?.vendor_name as string) || vendorId,
      classIds,
      // GENERIC ONLY — vendor_id + year + generic labels. Deliberately no vendor_name.
      license: {
        entity_type: 'vendor',
        vendor_id: vendorId,
        year,
        academicYear: year,
        // Generic values in the legacy fields so older apps still render something safe.
        school_name: 'Licensed Vendor',
        board: 'N/A',
        mediums: ['Semi-English'],
        section: 'N/A',
        standard: (vendor?.standard as string) || 'All',
        fullClassName: 'Vendor License',
      },
    };
  }

  if (ref.type === 'student') {
    const { data: parent } = await supabaseAdmin
      .from('parents')
      .select('id, parent_name, kid_name, grade')
      .eq('id', ref.parentId)
      .single();

    const grade = (parent?.grade as string) || '';
    const studentName = (parent?.kid_name as string) || 'Student';
    // Content entitlement from the parent's grade — same parser a school uses.
    const classIds = classIdsFromScope(grade);

    return {
      entityType: 'student',
      entityName: studentName,
      classIds,
      license: {
        entity_type: 'student',
        parent_id: parent?.id ?? ref.parentId ?? null,
        student_name: studentName,
        parent_name: (parent?.parent_name as string) || '',
        grade,
        academicYear: keyYear || CURRENT_ACADEMIC_YEAR,
        // Legacy-field fallbacks so older apps render the student, not a blank school.
        school_name: studentName,
        board: 'N/A',
        mediums: ['Semi-English'],
        section: 'N/A',
        standard: grade || 'Primary',
        fullClassName: grade ? `Grade ${grade}` : 'Individual Learner',
      },
    };
  }

  // ── school (default / unchanged shape) ──────────────────────────────────
  const { data: school } = await supabaseAdmin
    .from('schools')
    .select('*')
    .eq('id', ref.schoolId)
    .single();

  const schoolName = school ? (school.name as string) : 'LMS Institution';

  return {
    entityType: 'school',
    entityName: schoolName,
    classIds: schoolClassIds(school),
    license: {
      entity_type: 'school',
      school_id: ref.schoolId,
      school_name: schoolName,
      board: school ? school.board : 'State Board',
      mediums: school ? school.mediums : ['Semi-English'],
      academicYear: school?.academic_year || keyYear || CURRENT_ACADEMIC_YEAR,
      section: school?.section || 'Section A',
      standard: school?.standard || 'Primary',
      fullClassName: school?.full_class_name || 'Curriculum Portal',
    },
  };
}

/** True when an entity is entitled to EVERY content class (gates the legacy master CEK). */
export function isEntitledToAll(classIds: string[]): boolean {
  return CONTENT_CLASS_NUMBERS.every((n) => classIds.includes(`class_${n}`));
}
