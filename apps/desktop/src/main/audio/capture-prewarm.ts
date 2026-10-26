import type { CaptureHost } from './capture-host';

export type WindowActivity = { onActivityChange(listener: (active: boolean) => void): () => void };

export function prewarmWhenShown(window: WindowActivity, host: Pick<CaptureHost, 'prewarm'>): () => void {
  const stop = window.onActivityChange((active) => {
    if (!active) {
      return;
    }
    stop();
    host.prewarm();
  });
  return stop;
}
