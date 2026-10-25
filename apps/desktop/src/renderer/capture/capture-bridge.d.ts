import type { CaptureBridge } from '../../shared/capture-contract';

declare global {
  interface Window {
    readonly codevoCapture: CaptureBridge;
  }
}
