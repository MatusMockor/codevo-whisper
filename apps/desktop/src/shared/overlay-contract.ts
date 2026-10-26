export const OVERLAY_ACTIONS = ['open-settings', 'copy-last', 'open-server'] as const;

export type OverlayAction = (typeof OVERLAY_ACTIONS)[number];

export type BlockedReason = 'focus' | 'secure';

export type LiveText = { confirmed: string; tentative: string };

export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'recording'; elapsedMs: number; level: number; language: string; fallbackDevice?: string; live?: LiveText }
  | { kind: 'processing'; notice?: 'limit-reached'; live?: LiveText }
  | { kind: 'inserted'; appName: string }
  | { kind: 'copied' }
  | { kind: 'blocked'; reason: BlockedReason }
  | { kind: 'error'; message: string; action?: OverlayAction };

export type OverlayBridge = {
  onState(listener: (state: OverlayState) => void): () => void;
  act(action: OverlayAction): void;
};

export const OVERLAY_CHANNELS = Object.freeze({
  state: 'overlay:state',
  action: 'overlay:action',
});

export function isOverlayAction(value: unknown): value is OverlayAction {
  return OVERLAY_ACTIONS.some((action) => action === value);
}
