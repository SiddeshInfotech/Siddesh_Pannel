// Standard result for Server Actions.
//
// RETURN this for EXPECTED failures (validation, auth, business rules, wrong
// password, duplicates). Next.js REDACTS thrown errors in production — the client
// only ever gets a generic "An error occurred… digest" 500 — so throwing for
// control flow gives the user no usable message and looks like a server crash.
// A returned value is normal data and reaches the UI intact. Throw ONLY for truly
// unexpected bugs.
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// The only message shown to the UI when something unexpected happens — never leaks
// internal detail (stack, SQL, field names). Detailed context goes to server logs.
export const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
