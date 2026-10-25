import type { OverlayState } from '../../shared/overlay-contract';
import type { Settings } from '../../shared/settings';

export type TrayActivity = { kind: 'idle' } | { kind: 'recording' } | { kind: 'processing' } | { kind: 'error'; message: string };

export type TrayIconKind = 'idle' | 'recording' | 'processing' | 'paused' | 'error';

export const IDLE: TrayActivity = Object.freeze({ kind: 'idle' });

export function nextActivity(current: TrayActivity, state: OverlayState): TrayActivity {
  if (state.kind === 'recording' || state.kind === 'processing') {
    return { kind: state.kind };
  }
  if (state.kind === 'error') {
    return { kind: 'error', message: state.message };
  }
  if (state.kind === 'hidden' && current.kind === 'error') {
    return current;
  }
  return IDLE;
}

export function trayIconKind(activity: TrayActivity, paused: boolean): TrayIconKind {
  if (activity.kind === 'recording' || activity.kind === 'processing') {
    return activity.kind;
  }
  if (paused) {
    return 'paused';
  }
  return activity.kind;
}

export function statusLine(activity: TrayActivity, paused: boolean, settings: Pick<Settings, 'hotkey'>): string {
  if (activity.kind === 'recording') {
    return 'Nahrávam…';
  }
  if (activity.kind === 'processing') {
    return 'Spracúvam…';
  }
  if (paused) {
    return 'Diktovanie je pozastavené';
  }
  if (activity.kind === 'error') {
    return activity.message;
  }
  if (settings.hotkey === null) {
    return 'Nastavte klávesovú skratku v Nastaveniach';
  }
  return `Pripravené · ${settings.hotkey.label}`;
}
