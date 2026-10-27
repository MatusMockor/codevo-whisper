import { describe, expect, it } from 'vitest';
import { updateIndicatorView } from '../src/renderer/components/update-indicator';
import type { InstallOutcome, UpdateMode, UpdatePhase, UpdateStatus } from '../src/shared/updates';

function status(phase: UpdatePhase, mode: UpdateMode = 'in-app'): UpdateStatus {
  return { currentVersion: '1.1.0', mode, phase };
}

function view(phase: UpdatePhase, mode: UpdateMode = 'in-app', notice: InstallOutcome | null = null) {
  return updateIndicatorView(status(phase, mode), notice);
}

const RESTART = { id: 'install', label: 'Reštartovať', disabled: false } as const;

describe('updateIndicatorView', () => {
  it('shows the download progress without an action', () => {
    expect(view({ kind: 'downloading', version: '1.2.0', percent: 62 })).toEqual({ message: 'Sťahujem aktualizáciu… 62 %', note: null, percent: 62, action: null });
  });

  it('offers the restart when the update is ready', () => {
    expect(view({ kind: 'ready', version: '1.2.0' })).toEqual({ message: 'Aktualizácia 1.2.0 je pripravená', note: null, percent: null, action: RESTART });
  });

  it('asks to finish the dictation first when the restart was refused', () => {
    expect(view({ kind: 'ready', version: '1.2.0' }, 'in-app', 'dictation-active')).toEqual({
      message: 'Aktualizácia 1.2.0 je pripravená',
      note: 'Po dokončení diktovania to skúste znova.',
      percent: null,
      action: RESTART,
    });
    expect(view({ kind: 'ready', version: '1.2.0' }, 'in-app', 'not-ready')?.note).toBeNull();
  });

  it('disables the restart while the app restarts', () => {
    expect(view({ kind: 'installing', version: '1.2.0' }, 'in-app', 'restarting')).toEqual({
      message: 'Aktualizácia 1.2.0 je pripravená',
      note: null,
      percent: null,
      action: { id: 'install', label: 'Reštartujem…', disabled: true },
    });
  });

  it('links the download when the package cannot update itself', () => {
    expect(view({ kind: 'available', version: '1.2.0' }, 'manual')).toEqual({
      message: 'Je dostupná verzia 1.2.0',
      note: null,
      percent: null,
      action: { id: 'download', label: 'Stiahnuť z GitHubu', disabled: false },
    });
    expect(view({ kind: 'available', version: '1.2.0' }, 'in-app')).toBeNull();
  });

  it('stays hidden while there is nothing to act on', () => {
    const quiet: UpdatePhase[] = [
      { kind: 'idle', checked: false },
      { kind: 'idle', checked: true },
      { kind: 'checking' },
      { kind: 'stalled', version: '1.2.0' },
      { kind: 'error', failed: 'check' },
      { kind: 'error', failed: 'download' },
      { kind: 'error', failed: 'install' },
    ];

    for (const phase of quiet) {
      expect(view(phase)).toBeNull();
      expect(view(phase, 'manual')).toBeNull();
    }
  });

  it('stays hidden when the build does not update', () => {
    expect(view({ kind: 'ready', version: '1.2.0' }, 'unsupported')).toBeNull();
    expect(view({ kind: 'available', version: '1.2.0' }, 'unsupported')).toBeNull();
  });
});
