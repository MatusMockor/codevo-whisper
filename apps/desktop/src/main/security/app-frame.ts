import type { WebContents } from 'electron';
import { isTrustedSenderUrl } from '../ipc/trusted-sender';
import type { RendererSource } from '../windows/renderer-source';
import type { AppFrameCheck } from './permissions';

export function appFrameCheck(source: RendererSource, isMainContents: (contents: WebContents) => boolean): AppFrameCheck {
  return (contents, url) => contents !== null && isMainContents(contents) && isTrustedSenderUrl(url, source);
}
