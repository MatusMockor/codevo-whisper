import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { appFrameCheck } from '../src/main/security/app-frame';

const mainContents = { id: 1 } as unknown as WebContents;
const overlayContents = { id: 2 } as unknown as WebContents;

function isMain(contents: WebContents): boolean {
  return contents === mainContents;
}

describe('appFrameCheck', () => {
  it('accepts only the main window contents on the dev server', () => {
    const check = appFrameCheck({ kind: 'dev-server', url: 'http://localhost:5173/' }, isMain);

    expect(check(mainContents, 'http://localhost:5173/')).toBe(true);
    expect(check(overlayContents, 'http://localhost:5173/overlay/overlay.html')).toBe(false);
    expect(check(mainContents, 'https://example.invalid/')).toBe(false);
    expect(check(null, 'http://localhost:5173/')).toBe(false);
  });

  it('accepts only the main window contents loaded from the renderer file', () => {
    const check = appFrameCheck({ kind: 'file', path: '/app/out/renderer/index.html' }, isMain);

    expect(check(mainContents, 'file:///app/out/renderer/index.html')).toBe(true);
    expect(check(overlayContents, 'file:///app/out/renderer/index.html')).toBe(false);
    expect(check(mainContents, 'file:///app/out/renderer/overlay/overlay.html')).toBe(false);
    expect(check(mainContents, undefined)).toBe(false);
  });
});
