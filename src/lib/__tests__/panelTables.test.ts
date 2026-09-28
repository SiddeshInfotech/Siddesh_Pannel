import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { labEmbeds, panelForProduct, tableFor, PANEL_TABLES } from '../panelTables';

describe('LMS-Admin / Lab-Admin table split', () => {
  it('Lab-Admin uses lab_* tables, LMS-Admin the originals', () => {
    for (const t of PANEL_TABLES) {
      expect(tableFor('lms', t)).toBe(t);
      expect(tableFor('lab', t)).toBe(`lab_${t}`);
    }
  });

  it('routes devices by product family', () => {
    expect(panelForProduct('LAB_STEM_ANDROID')).toBe('lab');
    expect(panelForProduct('LMS_LAB_WINDOWS')).toBe('lab');
    expect(panelForProduct('LMS_SCHOOL_ANDROID')).toBe('lms');
    expect(panelForProduct('UNKNOWN')).toBe('lms');
    expect(panelForProduct(null)).toBe('lms');
  });

  it('aliases embedded selects to lab tables without changing row shape', () => {
    expect(labEmbeds('id, schools ( name ), vendors(vendor_name), parents ( parent_name )')).toBe(
      'id, schools:lab_schools ( name ), vendors:lab_vendors (vendor_name), parents:lab_parents ( parent_name )'
    );
    expect(labEmbeds('id, school_id, schools_count')).toBe('id, school_id, schools_count');
  });
});
