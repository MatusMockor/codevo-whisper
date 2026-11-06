import type { DesktopCapturerSource, DisplayMediaRequestHandlerHandlerRequest, Session, Streams, WebContents, WebFrameMain } from 'electron';
import { expect, it } from 'vitest';
import { installDisplayMediaHandler } from '../src/main/security/display-media';

type Handler = (request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams | null) => void) => void;

const CAPTURE_URL = 'file:///app/out/renderer/capture/capture.html';
const captureContents = { id: 1 } as unknown as WebContents;
const screen = { id: 'screen:1:0', name: 'Screen' } as unknown as DesktopCapturerSource;

function frame(url: string, parent: unknown = null): WebFrameMain {
  return { url, parent } as unknown as WebFrameMain;
}

function outcome(request: Partial<DisplayMediaRequestHandlerHandlerRequest>): Promise<Streams | null> {
  let handler: Handler | null = null;
  const session = { setDisplayMediaRequestHandler: (installed: Handler) => { handler = installed; } } as unknown as Session;
  installDisplayMediaHandler(session, {
    isCaptureFrame: (contents, url) => contents === captureContents && url === CAPTURE_URL,
    contentsOf: (requested) => (requested.url === CAPTURE_URL ? captureContents : null),
    screens: () => Promise.resolve([screen]),
  });
  return new Promise((resolve) => {
    handler?.({ frame: frame(CAPTURE_URL), securityOrigin: 'file://', videoRequested: true, audioRequested: true, userGesture: false, ...request }, resolve);
  });
}

it('grants system audio loopback with the first screen to the capture window', async () => {
  await expect(outcome({})).resolves.toEqual({ video: screen, audio: 'loopback' });
});

it('denies other frames, subframes, missing frames and video-only requests', async () => {
  await expect(outcome({ frame: frame('file:///app/out/renderer/index.html') })).resolves.toBeNull();
  await expect(outcome({ frame: frame(CAPTURE_URL, {}) })).resolves.toBeNull();
  await expect(outcome({ frame: null })).resolves.toBeNull();
  await expect(outcome({ audioRequested: false })).resolves.toBeNull();
});
