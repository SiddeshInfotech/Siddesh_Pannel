import { describe, expect, it, vi } from 'vitest';

const lmsFrom = vi.fn();
const labFrom = vi.fn();
vi.mock('../supabase', () => ({
  supabaseFor: (panel: string) => ({ from: panel === 'lab' ? labFrom : lmsFrom }),
}));

import { panelDb, panelForProduct } from '../panelTables';
import { PRODUCT_DEFINITIONS, productsForPanel } from '../productIdentity';

describe('LMS-Admin / Lab-Admin database split', () => {
  it('each panel queries only its own database', () => {
    panelDb('lab').from('activation_keys');
    expect(labFrom).toHaveBeenCalledWith('activation_keys');
    expect(lmsFrom).not.toHaveBeenCalled();
    panelDb('lms').from('schools');
    expect(lmsFrom).toHaveBeenCalledWith('schools');
  });

  it('routes devices by product: only the 5 booklet products go to Lab-Admin', () => {
    expect(panelForProduct('LAB_STEM_ANDROID')).toBe('lab');
    expect(panelForProduct('LAB_COMPOSITE_LINUX')).toBe('lab');
    expect(panelForProduct('LMS_LAB_WINDOWS')).toBe('lms'); // original LMS Lab app stays put
    expect(panelForProduct('LMS_SCHOOL_ANDROID')).toBe('lms');
    expect(panelForProduct('UNKNOWN')).toBe('lms');
    expect(panelForProduct(null)).toBe('lms');
  });

  it('Lab-Admin owns exactly 5 products x 3 OS', () => {
    expect(productsForPanel('lab')).toHaveLength(15);
    expect(PRODUCT_DEFINITIONS.filter((p) => p.panel === 'lab').every((p) => p.labPackage)).toBe(true);
  });
});
