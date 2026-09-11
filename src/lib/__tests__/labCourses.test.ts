import { describe, expect, it } from 'vitest';
import { LAB_COURSES, LAB_SCOPE_MAX, labScopeIds } from '../labCourses';

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
