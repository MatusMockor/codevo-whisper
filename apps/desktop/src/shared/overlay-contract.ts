import type { EngineId } from './settings';

export const OVERLAY_ACTIONS = ['open-settings', 'open-languages', 'copy-last', 'open-server', 'pair-server', 'download-model', 'use-server', 'use-local', 'enable-server', 'cancel'] as const;

export type OverlayAction = (typeof OVERLAY_ACTIONS)[number];

export type BlockedReason = 'focus' | 'secure';

export type LiveText = { confirmed: string; tentative: string };

export type OverlayError = { kind: 'error'; message: string; action?: OverlayAction; alternative?: OverlayAction };

export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'recording'; elapsedMs: number; level: number; languageChip: string; fallbackDevice?: string; live?: LiveText }
  | { kind: 'processing'; notice?: 'limit-reached'; live?: LiveText }
  | { kind: 'inserted'; appName: string; notice?: string }
  | { kind: 'copied'; notice?: string }
  | { kind: 'blocked'; reason: BlockedReason }
  | { kind: 'rerouted'; engine: EngineId }
  | OverlayError;

export type OverlayBridge = {
  controls: boolean;
  onState(listener: (state: OverlayState) => void): () => void;
  act(action: OverlayAction): void;
};

export const OVERLAY_CONTROLS_OFF = '--overlay-controls=off';

export const OVERLAY_CHANNELS = Object.freeze({
  state: 'overlay:state',
  action: 'overlay:action',
});

export function isOverlayAction(value: unknown): value is OverlayAction {
  return OVERLAY_ACTIONS.some((action) => action === value);
}

export function offeredActions(state: OverlayState): readonly OverlayAction[] {
  if (state.kind === 'blocked') {
    return ['copy-last'];
  }
  if (state.kind === 'recording' || state.kind === 'processing') {
    return ['cancel'];
  }
  if (state.kind !== 'error' || state.action === undefined) {
    return [];
  }
  return state.alternative === undefined ? [state.action] : [state.action, state.alternative];
}
