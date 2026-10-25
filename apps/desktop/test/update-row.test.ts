import { describe, expect, it } from 'vitest';
import { updateRowView, type UpdateRowView } from '../src/renderer/settings/update-row';
import type { UpdateMode, UpdatePhase, UpdateStatus } from '../src/shared/updates';

function status(phase: UpdatePhase, mode: UpdateMode = 'in-app'): UpdateStatus {
  return { currentVersion: '1.1.0', mode, phase };
}

const CHECK = { id: 'check', label: 'Skontrolovať aktualizácie', primary: false, disabled: false } as const;
const CHECK_DISABLED = { ...CHECK, disabled: true } as const;
const INSTALL = { id: 'install', label: 'Reštartovať a aktualizovať', primary: true, disabled: false } as const;

function view(phase: UpdatePhase, mode: UpdateMode = 'in-app'): UpdateRowView {
  return updateRowView(status(phase, mode), null);
}

describe('updateRowView', () => {
  it('shows the version and the check button before and after a check', () => {
    expect(view({ kind: 'idle', checked: false })).toEqual({ description: 'Verzia 1.1.0. Aktualizácie sa kontrolujú automaticky.', actions: [CHECK] });
    expect(view({ kind: 'idle', checked: true })).toEqual({ description: 'Verzia 1.1.0 je najnovšia.', actions: [CHECK] });
  });

  it('disables the check while checking and downloading', () => {
    expect(view({ kind: 'checking' })).toEqual({ description: 'Verzia 1.1.0. Hľadám aktualizácie…', actions: [CHECK_DISABLED] });
    expect(view({ kind: 'downloading', version: '1.2.0', percent: 42 })).toEqual({ description: 'Sťahujem verziu 1.2.0… 42 %', actions: [CHECK_DISABLED] });
  });

  it('offers the restart when the update is ready and while restarting disables it', () => {
    expect(view({ kind: 'ready', version: '1.2.0' })).toEqual({ description: 'Verzia 1.2.0 je pripravená. Nainštaluje sa po reštarte.', actions: [INSTALL] });
    expect(view({ kind: 'installing', version: '1.2.0' })).toEqual({
      description: 'Reštartujem a inštalujem verziu 1.2.0…',
      actions: [{ ...INSTALL, disabled: true }],
    });
  });

  it('asks to finish the dictation first when the restart was refused', () => {
    expect(updateRowView(status({ kind: 'ready', version: '1.2.0' }), 'dictation-active')).toEqual({
      description: 'Verzia 1.2.0 je pripravená. Najprv dokončite diktovanie, potom aplikáciu reštartujte.',
      actions: [INSTALL],
    });
    expect(updateRowView(status({ kind: 'idle', checked: true }), 'dictation-active').description).toBe('Verzia 1.1.0 je najnovšia.');
  });

  it('links the release page when the package cannot update itself', () => {
    expect(view({ kind: 'available', version: '1.2.0' }, 'manual')).toEqual({
      description: 'Je dostupná verzia 1.2.0. Stiahnite ju z GitHubu a nainštalujte.',
      actions: [{ id: 'download', label: 'Stiahnuť z GitHubu', primary: true, disabled: false }, CHECK],
    });
  });

  it('explains every failure and allows another check', () => {
    expect(view({ kind: 'error', failed: 'check' })).toEqual({ description: 'Aktualizácie sa nepodarilo skontrolovať. Skúste to neskôr.', actions: [CHECK] });
    expect(view({ kind: 'error', failed: 'download' })).toEqual({ description: 'Aktualizáciu sa nepodarilo stiahnuť. Skúste to znova.', actions: [CHECK] });
    expect(view({ kind: 'error', failed: 'install' })).toEqual({ description: 'Aktualizáciu sa nepodarilo nainštalovať. Zostáva verzia 1.1.0.', actions: [CHECK] });
  });

  it('explains that a development build does not update', () => {
    expect(view({ kind: 'idle', checked: false }, 'unsupported')).toEqual({
      description: 'Verzia 1.1.0. Aktualizácie fungujú iba v nainštalovanej aplikácii.',
      actions: [CHECK_DISABLED],
    });
  });
});
