import { describe, expect, it } from 'vitest';
import { LAB_COURSES, LAB_SCOPE_MAX, labScopeIds, labScopeIdsForPackage, masterCekFor, LAB_MASTER_CEK_ENV } from '../labCourses';
import { PRODUCT_DEFINITIONS, labPackageFor } from '../productIdentity';

describe('LMS Lab course registry', () => {
  it('numbers are unique and contiguous from 1 (a gap or reuse would strand encrypted content)', () => {
    const numbers = LAB_COURSES.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers.map((_, i) => i + 1));
  });

  it('folders are unique — one folder, one scope', () => {
    const folders = LAB_COURSES.map((c) => c.folder);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('keeps the numbering the app and encryptor use', () => {
    const byFolder = Object.fromEntries(LAB_COURSES.map((c) => [c.folder, `course_${c.number}`]));
    expect(byFolder).toMatchObject({
      electronics: 'course_1',
      mr: 'course_9',
      scratch: 'course_10',
      'c-programming': 'course_11',
    });
  });

  it('activation carries every real course plus the reserved future slots', () => {
    const scopes = labScopeIds();
    for (const c of LAB_COURSES) expect(scopes).toContain(`course_${c.number}`);
    expect(scopes).toHaveLength(LAB_SCOPE_MAX);
    expect(scopes[0]).toBe('course_1');
    expect(scopes.at(-1)).toBe(`course_${LAB_SCOPE_MAX}`);
    expect(LAB_SCOPE_MAX).toBeGreaterThan(Math.max(...LAB_COURSES.map((c) => c.number)));
  });
});

describe('LMS Lab products (booklet packages)', () => {
  it('each package carries only its booklet courses; composite keeps every scope', () => {
    expect(labScopeIdsForPackage('stem')).toEqual(['course_1', 'course_2', 'course_3', 'course_10']);
    expect(labScopeIdsForPackage('robodrone')).toEqual(['course_1', 'course_2', 'course_5', 'course_10']);
    expect(labScopeIdsForPackage('iotrobo')).toEqual(['course_1', 'course_2', 'course_3', 'course_10']);
    expect(labScopeIdsForPackage('aifuture')).toEqual(
      ['course_1', 'course_3', 'course_4', 'course_6', 'course_7', 'course_8', 'course_9', 'course_10']
    );
    expect(labScopeIdsForPackage('composite')).toEqual(labScopeIds());
  });

  it('only Lab-Admin products map to a package', () => {
    for (const p of PRODUCT_DEFINITIONS) {
      expect(labPackageFor(p.id) === null).toBe(p.panel === 'lms');
    }
  });

  it('each package reads its own master key and fails closed when unset', () => {
    const env = { LMS_MASTER_CEK: 'lms-master', LMS_LAB_MASTER_CEK_COMPOSITE: 'composite-master', LMS_LAB_MASTER_CEK_STEM: 'stem-master' };
    expect(masterCekFor('composite', env)).toBe('composite-master');
    expect(Object.values(LAB_MASTER_CEK_ENV)).not.toContain('LMS_MASTER_CEK'); // never reuses LMS-Admin's master
    expect(masterCekFor('stem', env)).toBe('stem-master');
    expect(masterCekFor('aifuture', env)).toBeNull();
    expect(new Set(Object.values(LAB_MASTER_CEK_ENV)).size).toBe(5);
  });
});
