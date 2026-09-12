import { describe, it, expect } from 'vitest';
import {
  DEVICE_CLASS_STANDARD,
  DEVICE_CLASS_MANAGED_PANEL,
  deviceClassAllowedFor,
  deviceClassLabel,
  isPanelKey,
  isMissingColumnError,
} from '@/lib/deviceClass';

describe('deviceClass — Interactive-panel keys', () => {
  it('only an explicitly marked key is a panel key (existing / NULL keys stay Standard)', () => {
    expect(isPanelKey({ device_class: DEVICE_CLASS_MANAGED_PANEL })).toBe(true);
    expect(isPanelKey({ device_class: null })).toBe(false);
    expect(isPanelKey({ device_class: DEVICE_CLASS_STANDARD })).toBe(false);
    expect(isPanelKey({})).toBe(false); // DB without the migrated column
    expect(isPanelKey(null)).toBe(false); // unknown key
    expect(isPanelKey({ device_class: 'MANAGED_PANEL' })).toBe(false); // exact value only
  });

  it('panel keys are allowed for Android products only', () => {
    expect(deviceClassAllowedFor('LMS_LAB_ANDROID', DEVICE_CLASS_MANAGED_PANEL)).toBe(true);
    expect(deviceClassAllowedFor('LMS_SCHOOL_ANDROID', DEVICE_CLASS_MANAGED_PANEL)).toBe(true);
    expect(deviceClassAllowedFor('LMS_LAB_WINDOWS', DEVICE_CLASS_MANAGED_PANEL)).toBe(false);
    expect(deviceClassAllowedFor('LMS_LAB_LINUX', DEVICE_CLASS_MANAGED_PANEL)).toBe(false);
    expect(deviceClassAllowedFor('LMS_LAB_WINDOWS', DEVICE_CLASS_STANDARD)).toBe(true);
  });

  it('labels', () => {
    expect(deviceClassLabel(DEVICE_CLASS_MANAGED_PANEL)).toBe('Interactive panel');
    expect(deviceClassLabel(null)).toBe('Standard');
  });

  it('recognises the not-yet-migrated column error', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column "device_class" does not exist' })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'device_class' column" })).toBe(true);
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});
