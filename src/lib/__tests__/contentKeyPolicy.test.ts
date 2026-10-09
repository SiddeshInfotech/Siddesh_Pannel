import { describe, expect, it } from 'vitest';
import { mayReleaseLegacyMasterKey } from '../contentKeyPolicy';

describe('School content master isolation', () => {
  const allClasses = ['class_1', 'class_2', 'class_3', 'class_4'];
  it.each(['LMS_SCHOOL_ANDROID', 'LMS_SCHOOL_WINDOWS'])('%s never receives a master, even with all classes', (product) => {
    expect(mayReleaseLegacyMasterKey(product, allClasses, false)).toBe(false);
  });
  it('unknown product cannot obtain a master key', () => {
    expect(mayReleaseLegacyMasterKey('unknown', allClasses, false)).toBe(false);
  });
  it('does not change the separate Lab migration path', () => {
    expect(mayReleaseLegacyMasterKey('LMS_LAB_WINDOWS', allClasses, false)).toBe(true);
    expect(mayReleaseLegacyMasterKey('LMS_LAB_WINDOWS', allClasses, true)).toBe(false);
    expect(mayReleaseLegacyMasterKey('LMS_LAB_WINDOWS', ['class_1'], false)).toBe(false);
  });
});
