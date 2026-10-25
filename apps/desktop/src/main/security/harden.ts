import type { WebContents } from 'electron';

export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
