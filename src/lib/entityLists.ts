// Name lists of schools / vendors / parents for the pickers on the Keys and Payments pages.
// They change rarely, so they are cached instead of re-read with 3 queries per page view.
//
// Kept in THIS server process's memory only (src/lib/swrCache.ts) — never in Next's persistent
// data cache — so school and parent names are not copied into any store outside Supabase.
//   - every action that creates, renames or deletes one calls invalidateEntityLists(panel):
//     on this server instance the change shows on the next render;
//   - other instances, and writes from elsewhere (SQL editor, another app), show within 30 s.
// Cached per panel; only id + name are cached, and the pages still check the admin session first.
import 'server-only';
import { swrCache } from './swrCache';
import { panelDb, type Panel } from './panelTables';

export type EntityOption = { id: string; name: string };
export type EntityLists = { schools: EntityOption[]; vendors: EntityOption[]; parents: EntityOption[] };

const cache = swrCache<EntityLists>({ freshMs: 10_000, maxMs: 30_000, maxEntries: 4 });

async function loadEntityLists(panel: Panel): Promise<EntityLists> {
  const db = panelDb(panel);
  const [schools, vendors, parents] = await Promise.all([
    db.from('schools').select('id, name').order('name', { ascending: true }),
    db.from('vendors').select('vendor_id, vendor_name').order('vendor_name', { ascending: true }),
    db.from('parents').select('id, parent_name').order('parent_name', { ascending: true }),
  ]);
  // A failed read must not be cached as "no schools": throw so nothing is stored.
  const error = schools.error ?? vendors.error ?? parents.error;
  if (error) throw new Error(`entity lists: ${error.message}`);
  return {
    schools: (schools.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    vendors: (vendors.data ?? []).map((v) => ({ id: v.vendor_id, name: v.vendor_name })),
    parents: (parents.data ?? []).map((p) => ({ id: p.id, name: p.parent_name })),
  };
}

/** Cached name lists of [panel] (empty lists if the database cannot be read, as before). */
export async function getEntityLists(panel: Panel): Promise<EntityLists> {
  return cache.get(panel, () => loadEntityLists(panel)).catch(() => ({ schools: [], vendors: [], parents: [] }));
}

/** Call after creating, renaming or deleting a school, vendor or parent of [panel]. */
export function invalidateEntityLists(panel: Panel) {
  cache.invalidate(panel);
}
