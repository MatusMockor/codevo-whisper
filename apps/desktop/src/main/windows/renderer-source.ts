import { app } from 'electron';
import { fileURLToPath } from 'node:url';

export type RendererSource = { kind: 'dev-server'; url: string } | { kind: 'file'; path: string };

export function rendererSource(): RendererSource {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl !== undefined) {
    return { kind: 'dev-server', url: devServerUrl };
  }
  return { kind: 'file', path: fileURLToPath(new URL('../renderer/index.html', import.meta.url)) };
}
