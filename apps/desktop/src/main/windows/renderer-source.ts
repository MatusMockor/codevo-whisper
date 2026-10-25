import { app } from 'electron';
import { fileURLToPath } from 'node:url';

export type RendererSource = { kind: 'dev-server'; url: string } | { kind: 'file'; path: string };

export type RendererPage = 'main' | 'capture' | 'overlay';

const PAGE_PATHS: { readonly [P in RendererPage]: string } = Object.freeze({
  main: 'index.html',
  capture: 'capture/capture.html',
  overlay: 'overlay/overlay.html',
});

const DEV_SERVER_PATHS: { readonly [P in RendererPage]: string } = Object.freeze({
  main: '',
  capture: PAGE_PATHS.capture,
  overlay: PAGE_PATHS.overlay,
});

export function rendererSource(page: RendererPage = 'main'): RendererSource {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl !== undefined) {
    return { kind: 'dev-server', url: new URL(DEV_SERVER_PATHS[page], devServerUrl).href };
  }
  return { kind: 'file', path: fileURLToPath(new URL(`../renderer/${PAGE_PATHS[page]}`, import.meta.url)) };
}
