export type UpdateMode = 'in-app' | 'manual' | 'unsupported';

export type UpdateFailure = 'check' | 'download' | 'install';

export type UpdatePhase =
  | { kind: 'idle'; checked: boolean }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'stalled'; version: string }
  | { kind: 'error'; failed: UpdateFailure };

export type UpdateStatus = { currentVersion: string; mode: UpdateMode; phase: UpdatePhase };

const CHECKABLE: ReadonlySet<UpdatePhase['kind']> = new Set(['idle', 'available', 'error']);

export function canCheckForUpdates(status: UpdateStatus): boolean {
  return status.mode !== 'unsupported' && CHECKABLE.has(status.phase.kind);
}

export type InstallOutcome = 'restarting' | 'dictation-active' | 'not-ready';

export const RELEASES_URL = 'https://github.com/MatusMockor/codevo-whisper/releases/latest';
