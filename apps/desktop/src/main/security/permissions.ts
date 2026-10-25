import type { PermissionCheckHandlerHandlerDetails, PermissionRequest, Session, WebContents } from 'electron';

export type CaptureFrameCheck = (contents: WebContents | null, url: string | undefined) => boolean;

export type AppFrameCheck = (contents: WebContents | null, url: string | undefined) => boolean;

export type FrameChecks = { isCaptureFrame: CaptureFrameCheck; isAppFrame: AppFrameCheck };

const CLIPBOARD_WRITE = 'clipboard-sanitized-write';

function requestsAudioOnly(details: PermissionRequest): boolean {
  if (!('mediaTypes' in details) || !Array.isArray(details.mediaTypes)) {
    return false;
  }
  const mediaTypes: unknown[] = details.mediaTypes;
  return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
}

function grantsRequest({ isCaptureFrame, isAppFrame }: FrameChecks, contents: WebContents, permission: string, details: PermissionRequest): boolean {
  if (permission === CLIPBOARD_WRITE) {
    return details.isMainFrame && isAppFrame(contents, details.requestingUrl);
  }
  if (permission !== 'media' || !details.isMainFrame || !requestsAudioOnly(details)) {
    return false;
  }
  return isCaptureFrame(contents, details.requestingUrl);
}

function grantsCheck({ isCaptureFrame, isAppFrame }: FrameChecks, contents: WebContents | null, permission: string, details: PermissionCheckHandlerHandlerDetails): boolean {
  if (permission === CLIPBOARD_WRITE) {
    return details.isMainFrame && isAppFrame(contents, details.requestingUrl);
  }
  if (permission !== 'media' || !details.isMainFrame || details.mediaType !== 'audio') {
    return false;
  }
  return isCaptureFrame(contents, details.requestingUrl);
}

export function installPermissionHandlers(session: Session, frames: FrameChecks): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(grantsRequest(frames, contents, permission, details));
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => grantsCheck(frames, contents, permission, details));
}
