import type { PermissionCheckHandlerHandlerDetails, PermissionRequest, Session, WebContents } from 'electron';

export type CaptureFrameCheck = (contents: WebContents | null, url: string | undefined) => boolean;

function requestsAudioOnly(details: PermissionRequest): boolean {
  if (!('mediaTypes' in details) || !Array.isArray(details.mediaTypes)) {
    return false;
  }
  const mediaTypes: unknown[] = details.mediaTypes;
  return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
}

function grantsRequest(isCaptureFrame: CaptureFrameCheck, contents: WebContents, permission: string, details: PermissionRequest): boolean {
  if (permission !== 'media' || !details.isMainFrame || !requestsAudioOnly(details)) {
    return false;
  }
  return isCaptureFrame(contents, details.requestingUrl);
}

function grantsCheck(isCaptureFrame: CaptureFrameCheck, contents: WebContents | null, permission: string, details: PermissionCheckHandlerHandlerDetails): boolean {
  if (permission !== 'media' || !details.isMainFrame || details.mediaType !== 'audio') {
    return false;
  }
  return isCaptureFrame(contents, details.requestingUrl);
}

export function installPermissionHandlers(session: Session, isCaptureFrame: CaptureFrameCheck): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(grantsRequest(isCaptureFrame, contents, permission, details));
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => grantsCheck(isCaptureFrame, contents, permission, details));
}
