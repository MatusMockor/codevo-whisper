import { describe, expect, it } from 'vitest';
import { inputPermissionAction, offersManualAdd, relaunchReason } from '../src/renderer/onboarding/input-permission-flow';
import type { PermissionsView } from '../src/renderer/settings/permissions-view';

const MISSING: PermissionsView = { microphone: 'granted', inputMonitoring: false, accessibility: false, hotkeyArmed: false, asked: [], canRevealApp: true };

describe('inputPermissionAction', () => {
  it('asks macOS first and opens System Settings once the app has asked', () => {
    expect(inputPermissionAction(MISSING, 'input-monitoring')).toEqual({ run: 'request', label: 'Povoliť' });
    expect(inputPermissionAction({ ...MISSING, asked: ['input-monitoring'] }, 'input-monitoring')).toEqual({ run: 'open-settings', label: 'Otvoriť Nastavenia systému' });
    expect(inputPermissionAction({ ...MISSING, asked: ['input-monitoring'] }, 'accessibility')).toEqual({ run: 'request', label: 'Povoliť' });
  });
});

describe('offersManualAdd', () => {
  it('offers the Finder fallback only for an asked, still missing permission on macOS', () => {
    expect(offersManualAdd(MISSING, 'accessibility')).toBe(false);
    expect(offersManualAdd({ ...MISSING, asked: ['accessibility'] }, 'accessibility')).toBe(true);
    expect(offersManualAdd({ ...MISSING, asked: ['accessibility'], accessibility: true }, 'accessibility')).toBe(false);
    expect(offersManualAdd({ ...MISSING, asked: ['accessibility'], canRevealApp: false }, 'accessibility')).toBe(false);
    expect(offersManualAdd({ ...MISSING, asked: ['accessibility'] }, 'input-monitoring')).toBe(false);
  });
});

describe('relaunchReason', () => {
  it('asks for a relaunch after Input Monitoring was requested or granted without an armed hotkey', () => {
    expect(relaunchReason(MISSING)).toBeNull();
    expect(relaunchReason({ ...MISSING, asked: ['accessibility'] })).toBeNull();
    expect(relaunchReason({ ...MISSING, asked: ['input-monitoring'] })).toBe('pending');
    expect(relaunchReason({ ...MISSING, inputMonitoring: true })).toBe('unarmed');
    expect(relaunchReason({ ...MISSING, inputMonitoring: true, hotkeyArmed: true, asked: ['input-monitoring'] })).toBeNull();
  });
});
