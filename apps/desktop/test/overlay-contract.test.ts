import { describe, expect, it } from 'vitest';
import { isOverlayAction, offeredActions } from '../src/shared/overlay-contract';

describe('overlay contract', () => {
  it('offers only the actions the shown state carries', () => {
    expect(offeredActions({ kind: 'error', message: 'Lokálny model chýba', action: 'use-server', alternative: 'download-model' })).toEqual(['use-server', 'download-model']);
    expect(offeredActions({ kind: 'error', message: 'Server nie je dostupný', action: 'use-local' })).toEqual(['use-local']);
    expect(offeredActions({ kind: 'error', message: 'Prepis sa nepodaril' })).toEqual([]);
    expect(offeredActions({ kind: 'error', message: 'Prepis sa nepodaril', action: 'retry' })).toEqual(['retry']);
    expect(offeredActions({ kind: 'blocked', reason: 'focus' })).toEqual(['copy-last']);
    expect(offeredActions({ kind: 'rerouted', engine: 'server' })).toEqual([]);
    expect(offeredActions({ kind: 'hidden' })).toEqual([]);
    expect(offeredActions({ kind: 'recording', elapsedMs: 0, level: 0, languageChip: 'AUTO' })).toEqual(['cycle-language', 'cancel']);
    expect(offeredActions({ kind: 'recording', elapsedMs: 0, level: 0, languageChip: 'AUTO', polish: false })).toEqual(['toggle-polish', 'cycle-language', 'cancel']);
    expect(offeredActions({ kind: 'processing' })).toEqual(['cancel']);
    expect(offeredActions({ kind: 'processing', polish: true })).toEqual(['toggle-polish', 'cancel']);
    expect(offeredActions({ kind: 'processing', polish: true, delivering: true })).toEqual([]);
    expect(offeredActions({ kind: 'inserted', appName: 'Notes' })).toEqual([]);
  });

  it('offers the target lock while recording only when the target can be locked', () => {
    const recording = { kind: 'recording', elapsedMs: 0, level: 0, languageChip: 'AUTO' } as const;
    expect(offeredActions({ ...recording, target: { name: 'Notes', lock: 'unlocked' } })).toEqual(['cycle-language', 'lock-target', 'cancel']);
    expect(offeredActions({ ...recording, target: { name: 'Notes', lock: 'locked' } })).toEqual(['cycle-language', 'lock-target', 'cancel']);
    expect(offeredActions({ ...recording, target: { name: 'Notes', lock: 'unavailable' } })).toEqual(['cycle-language', 'cancel']);
    expect(offeredActions({ kind: 'processing' })).toEqual(['cancel']);
    expect(isOverlayAction('lock-target')).toBe(true);
  });

  it('accepts only known action names', () => {
    expect(isOverlayAction('use-server')).toBe(true);
    expect(isOverlayAction('download-model')).toBe(true);
    expect(isOverlayAction('retry')).toBe(true);
    expect(isOverlayAction('delete-model')).toBe(false);
    expect(isOverlayAction({ action: 'use-server' })).toBe(false);
  });
});
