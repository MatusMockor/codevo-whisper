import type { OverlayAction } from '../../shared/overlay-contract';

export type SessionKey = 'escape';
export type SessionModifier = 'control' | 'alt' | 'shift' | 'meta';
export type SessionShortcut = { action: OverlayAction; key: SessionKey; modifiers: readonly SessionModifier[] };

export const SESSION_SHORTCUTS: readonly SessionShortcut[] = Object.freeze([{ action: 'cancel', key: 'escape', modifiers: [] }]);

export const SESSION_KEYCODES: Readonly<Record<SessionKey, { darwin: number; linux: number }>> = Object.freeze({
  escape: { darwin: 53, linux: 1 },
});
