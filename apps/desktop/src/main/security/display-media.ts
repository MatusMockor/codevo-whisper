import type { DesktopCapturerSource, Session, WebContents, WebFrameMain } from 'electron';
import type { CaptureFrameCheck } from './permissions';

export type DisplayMediaDeps = {
  isCaptureFrame: CaptureFrameCheck;
  contentsOf: (frame: WebFrameMain) => WebContents | null;
  screens: () => Promise<DesktopCapturerSource[]>;
};

export function installDisplayMediaHandler(session: Session, { isCaptureFrame, contentsOf, screens }: DisplayMediaDeps): void {
  session.setDisplayMediaRequestHandler((request, callback) => {
    const frame = request.frame;
    if (frame === null || frame.parent !== null || !request.audioRequested || !isCaptureFrame(contentsOf(frame), frame.url)) {
      callback(null);
      return;
    }
    screens().then(
      ([screen]) => callback(screen === undefined ? null : { video: screen, audio: 'loopback' }),
      () => callback(null),
    );
  });
}
