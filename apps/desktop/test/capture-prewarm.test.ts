import { describe, expect, it } from 'vitest';
import { prewarmWhenShown, type WindowActivity } from '../src/main/audio/capture-prewarm';
import { Listeners } from '../src/main/helper/listeners';
import { FakeCaptureHost } from './fake-capture-host';
import { RecordingLogger } from './recording-logger';

class FakeMainWindow implements WindowActivity {
  private readonly listeners = new Listeners<boolean>(new RecordingLogger(), 'A test activity listener failed');

  onActivityChange(listener: (active: boolean) => void): () => void {
    return this.listeners.add(listener);
  }

  activity(active: boolean): void {
    this.listeners.emit(active);
  }
}

describe('prewarmWhenShown', () => {
  it('does not prepare the capture window before the main window is on screen', () => {
    const host = new FakeCaptureHost();
    prewarmWhenShown(new FakeMainWindow(), host);

    expect(host.prewarms).toBe(0);
  });

  it('prepares the capture window once when the main window is first on screen', () => {
    const window = new FakeMainWindow();
    const host = new FakeCaptureHost();
    prewarmWhenShown(window, host);

    window.activity(false);
    window.activity(true);
    window.activity(false);
    window.activity(true);

    expect(host.prewarms).toBe(1);
    expect(host.requests).toEqual([]);
  });

  it('never prepares the capture window after it is disposed', () => {
    const window = new FakeMainWindow();
    const host = new FakeCaptureHost();
    const dispose = prewarmWhenShown(window, host);

    dispose();
    window.activity(true);

    expect(host.prewarms).toBe(0);
  });
});
