import { describe, expect, it } from 'vitest';
import { updateFooterView } from '../src/renderer/components/update-footer';
import type { UpdateMode, UpdatePhase, UpdateStatus } from '../src/shared/updates';

function status(phase: UpdatePhase, mode: UpdateMode = 'in-app'): UpdateStatus {
  return { currentVersion: '1.1.0', mode, phase };
}

function view(phase: UpdatePhase, mode: UpdateMode = 'in-app') {
  return updateFooterView(status(phase, mode));
}

const QUIET = { version: 'Verzia 1.1.0', result: null, checking: false, disabled: false, title: 'Skontrolovať aktualizácie' } as const;

describe('updateFooterView', () => {
  it('shows the version and an enabled check before any check', () => {
    expect(view({ kind: 'idle', checked: false })).toEqual(QUIET);
    expect(view({ kind: 'idle', checked: false }, 'manual')).toEqual(QUIET);
  });

  it('spins the disabled check while checking', () => {
    expect(view({ kind: 'checking' })).toEqual({ ...QUIET, result: 'Hľadám aktualizácie…', checking: true, disabled: true });
  });

  it('confirms the newest version after a check', () => {
    expect(view({ kind: 'idle', checked: true })).toEqual({ ...QUIET, result: 'Máte najnovšiu verziu' });
  });

  it('reports a failed check and allows another one', () => {
    expect(view({ kind: 'error', failed: 'check' })).toEqual({ ...QUIET, result: 'Kontrola zlyhala' });
    expect(view({ kind: 'error', failed: 'download' })).toEqual(QUIET);
    expect(view({ kind: 'error', failed: 'install' })).toEqual(QUIET);
  });

  it('leaves a found update to the indicator and keeps the check available', () => {
    expect(view({ kind: 'available', version: '1.2.0' }, 'manual')).toEqual(QUIET);
  });

  it('disables the check while an update downloads or installs', () => {
    const busy: UpdatePhase[] = [
      { kind: 'downloading', version: '1.2.0', percent: 40 },
      { kind: 'ready', version: '1.2.0' },
      { kind: 'installing', version: '1.2.0' },
      { kind: 'stalled', version: '1.2.0' },
    ];

    for (const phase of busy) {
      expect(view(phase)).toEqual({ ...QUIET, disabled: true });
    }
  });

  it('explains that a development build does not update', () => {
    expect(view({ kind: 'idle', checked: false }, 'unsupported')).toEqual({ ...QUIET, disabled: true, title: 'Aktualizácie fungujú iba v nainštalovanej aplikácii' });
    expect(view({ kind: 'checking' }, 'unsupported')).toEqual({ ...QUIET, disabled: true, title: 'Aktualizácie fungujú iba v nainštalovanej aplikácii' });
  });
});
