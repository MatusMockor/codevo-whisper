import { describe, expect, it } from 'vitest';
import { isOverlayAction, offeredActions } from '../src/shared/overlay-contract';

describe('overlay contract', () => {
  it('offers only the actions the shown state carries', () => {
    expect(offeredActions({ kind: 'error', message: 'Lokálny model chýba', action: 'use-server', alternative: 'download-model' })).toEqual(['use-server', 'download-model']);
    expect(offeredActions({ kind: 'error', message: 'Server nie je dostupný', action: 'use-local' })).toEqual(['use-local']);
    expect(offeredActions({ kind: 'error', message: 'Prepis sa nepodaril' })).toEqual([]);
    expect(offeredActions({ kind: 'blocked', reason: 'focus' })).toEqual(['copy-last']);
    expect(offeredActions({ kind: 'rerouted', engine: 'server' })).toEqual([]);
    expect(offeredActions({ kind: 'hidden' })).toEqual([]);
  });

  it('accepts only known action names', () => {
    expect(isOverlayAction('use-server')).toBe(true);
    expect(isOverlayAction('download-model')).toBe(true);
    expect(isOverlayAction('delete-model')).toBe(false);
    expect(isOverlayAction({ action: 'use-server' })).toBe(false);
  });
});
