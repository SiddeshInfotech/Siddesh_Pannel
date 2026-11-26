// Leads: the LMS School website's contact-form enquiries, shown in LMS-Admin. Safe for the browser.

/** Stored stage → label. 'new' is a lead nobody has looked at yet. */
export const LEAD_STAGES = {
  new: 'View', contacted: 'Contact', call: 'Call', email: 'Email', discussion: 'Discussion', won: 'Win', lost: 'Lose',
} as const;
export type LeadStage = keyof typeof LEAD_STAGES;
export const isLeadStage = (value: unknown): value is LeadStage => typeof value === 'string' && Object.hasOwn(LEAD_STAGES, value);
export const LEADS_PAGE_SIZE = 50;

export interface Lead {
  id: string; ref_no: number; name: string; email: string; phone: string | null; best_time: string | null;
  role: string | null; city: string | null; product: string | null; student_count: string | null; class_range: string | null;
  timeline: string | null; message: string; status: LeadStage; created_at: string; updated_at: string | null;
  panel_updated_by: string | null;
}

// The website contact form's choices (LMS-School-Online src/lib/sales-enquiry.ts), for editing a lead.
export const LEAD_ROLES = ['Parent or student', 'Teacher', 'School', 'Coaching institute', 'Franchise partner', 'Vendor or reseller'] as const;
export const LEAD_TIMELINES = ['this month', 'in 1–3 months', 'in 3–6 months', 'when we are ready (just exploring)'] as const;
export const LEAD_BEST_TIMES = ['Any time', 'Morning', 'Afternoon', 'Evening'] as const;

export interface LeadEdit {
  name: string; email: string; phone: string; city: string; role: string; best_time: string; timeline: string; message: string;
}

export interface LeadEvent { kind: 'created' | 'stage' | 'edited'; from_status: string | null; to_status: string | null; by_email: string | null; at: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks an edit the way the website form does. Returns the clean values, or field errors. */
export function cleanLeadEdit(input: Partial<Record<keyof LeadEdit, unknown>>):
  { ok: true; value: { name: string; email: string; phone: string | null; city: string | null; role: string | null; best_time: string | null; timeline: string | null; message: string } }
  | { ok: false; errors: Partial<Record<keyof LeadEdit, string>> } {
  const s = (k: keyof LeadEdit) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  const pick = (k: keyof LeadEdit, list: readonly string[]) => (list.includes(s(k)) ? s(k) : null);
  const errors: Partial<Record<keyof LeadEdit, string>> = {};
  const name = s('name');
  const email = s('email').toLowerCase();
  const digits = s('phone').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  const phone = digits ? (/^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : undefined) : null;
  const city = s('city');
  const message = s('message');
  if (!name || name.length > 200) errors.name = 'Enter a name (up to 200 characters).';
  if (!EMAIL.test(email) || email.length > 254) errors.email = 'Enter an email like name@example.com.';
  if (phone === undefined) errors.phone = 'Enter a 10-digit Indian mobile number, or leave it empty.';
  if (city.length > 100) errors.city = 'Use 100 characters or fewer.';
  if (message.length > 5000) errors.message = 'Use 5000 characters or fewer.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, email, phone: phone ?? null, city: city || null, role: pick('role', LEAD_ROLES),
      best_time: phone ? pick('best_time', LEAD_BEST_TIMES) : null, timeline: pick('timeline', LEAD_TIMELINES), message,
    },
  };
}
