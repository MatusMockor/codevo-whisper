import { pathToFileURL } from 'node:url';
import type { RendererSource } from '../windows/renderer-source';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isTrustedSenderUrl(url: string | undefined, source: RendererSource): boolean {
  const sender = url === undefined ? null : parseUrl(url);
  if (sender === null) {
    return false;
  }
  if (source.kind === 'dev-server') {
    return sender.origin === new URL(source.url).origin;
  }
  const expected = pathToFileURL(source.path);
  return sender.protocol === 'file:' && sender.pathname === expected.pathname;
}
