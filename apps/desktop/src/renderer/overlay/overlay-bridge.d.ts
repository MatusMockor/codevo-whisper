import type { OverlayBridge } from '../../shared/overlay-contract';

declare global {
  interface Window {
    readonly codevoOverlay: OverlayBridge;
  }
}
