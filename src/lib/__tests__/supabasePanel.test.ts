import { beforeAll, describe, expect, it, vi } from 'vitest';

const from = vi.fn(() => ({ select: vi.fn((cols: string) => cols) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from }) }));

let supabaseFor: typeof import('../supabase').supabaseFor;
let labEmbeds: typeof import('../supabase').labEmbeds;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  ({ supabaseFor, labEmbeds } = await import('../supabase'));
});

describe('Lab-Admin table set (same database, separate lab_* tables)', () => {
  it('Lab-Admin reads only lab_* tables, including its own login tables', () => {
    supabaseFor('lab').from('activation_keys');
    supabaseFor('lab').from('admin_users');
    expect(from).toHaveBeenCalledWith('lab_activation_keys');
    expect(from).toHaveBeenCalledWith('lab_admin_users');
  });

  it('LMS-Admin keeps the original tables', () => {
    supabaseFor('lms').from('admin_users');
    expect(from).toHaveBeenLastCalledWith('admin_users');
  });

  it('Lab embedded selects point at lab tables without changing row shape', () => {
    expect(supabaseFor('lab').from('payments').select('id, schools ( name )')).toBe('id, schools:lab_schools ( name )');
    expect(labEmbeds('id, school_id, schools_count')).toBe('id, school_id, schools_count');
  });
});
