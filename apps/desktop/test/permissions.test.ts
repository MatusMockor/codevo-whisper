import type { PermissionCheckHandlerHandlerDetails, PermissionRequest, Session, WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { installPermissionHandlers } from '../src/main/security/permissions';

type RequestHandler = (contents: WebContents, permission: string, callback: (granted: boolean) => void, details: PermissionRequest) => void;
type CheckHandler = (contents: WebContents | null, permission: string, origin: string, details: PermissionCheckHandlerHandlerDetails) => boolean;

const CAPTURE_URL = 'file:///app/out/renderer/capture/capture.html';
const MAIN_URL = 'file:///app/out/renderer/index.html';

class FakeSession {
  request: RequestHandler | null = null;
  check: CheckHandler | null = null;

  setPermissionRequestHandler(handler: RequestHandler): void {
    this.request = handler;
  }

  setPermissionCheckHandler(handler: CheckHandler): void {
    this.check = handler;
  }

  asSession(): Session {
    return this as unknown as Session;
  }
}

const captureContents = { id: 1 } as unknown as WebContents;
const mainContents = { id: 2 } as unknown as WebContents;

function installed(): FakeSession {
  const session = new FakeSession();
  installPermissionHandlers(session.asSession(), (contents, url) => contents === captureContents && url === CAPTURE_URL);
  return session;
}

function requestOutcome(session: FakeSession, contents: WebContents, permission: string, details: Partial<PermissionRequest> & Record<string, unknown>): boolean {
  let granted: boolean | null = null;
  const callback = (value: boolean): void => {
    granted = value;
  };
  session.request?.(contents, permission, callback, { requestingUrl: CAPTURE_URL, isMainFrame: true, ...details });
  expect(granted).not.toBeNull();
  return granted === true;
}

function checkOutcome(session: FakeSession, contents: WebContents | null, permission: string, details: Partial<PermissionCheckHandlerHandlerDetails>): boolean {
  return session.check?.(contents, permission, 'file:///', { isMainFrame: true, requestingUrl: CAPTURE_URL, ...details }) ?? false;
}

describe('installPermissionHandlers', () => {
  it('grants microphone access to the capture window', () => {
    expect(requestOutcome(installed(), captureContents, 'media', { mediaTypes: ['audio'] })).toBe(true);
  });

  it('denies camera access to the capture window', () => {
    const session = installed();

    expect(requestOutcome(session, captureContents, 'media', { mediaTypes: ['video'] })).toBe(false);
    expect(requestOutcome(session, captureContents, 'media', { mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(requestOutcome(session, captureContents, 'media', { mediaTypes: [] })).toBe(false);
    expect(requestOutcome(session, captureContents, 'media', {})).toBe(false);
  });

  it('denies microphone access to every other window or url', () => {
    const session = installed();

    expect(requestOutcome(session, mainContents, 'media', { mediaTypes: ['audio'], requestingUrl: MAIN_URL })).toBe(false);
    expect(requestOutcome(session, mainContents, 'media', { mediaTypes: ['audio'] })).toBe(false);
    expect(requestOutcome(session, captureContents, 'media', { mediaTypes: ['audio'], requestingUrl: 'https://example.invalid/' })).toBe(false);
  });

  it('denies every other permission, even to the capture window', () => {
    const session = installed();

    for (const permission of ['notifications', 'geolocation', 'clipboard-read', 'display-capture', 'midiSysex', 'openExternal', 'fullscreen']) {
      expect(requestOutcome(session, captureContents, permission, {})).toBe(false);
    }
  });

  it('answers permission checks for the microphone in the capture window only', () => {
    const session = installed();

    expect(checkOutcome(session, captureContents, 'media', { mediaType: 'audio' })).toBe(true);
    expect(checkOutcome(session, captureContents, 'media', { mediaType: 'video' })).toBe(false);
    expect(checkOutcome(session, captureContents, 'media', { mediaType: 'unknown' })).toBe(false);
    expect(checkOutcome(session, mainContents, 'media', { mediaType: 'audio', requestingUrl: MAIN_URL })).toBe(false);
    expect(checkOutcome(session, null, 'media', { mediaType: 'audio' })).toBe(false);
    expect(checkOutcome(session, captureContents, 'clipboard-read', {})).toBe(false);
  });
});
