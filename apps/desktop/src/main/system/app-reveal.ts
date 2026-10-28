import { appBundlePath } from './app-bundle';
import type { DesktopShell } from './desktop-shell';

export type AppRevealDeps = {
  platform: NodeJS.Platform;
  executablePath: string;
  shell: Pick<DesktopShell, 'showItemInFolder'>;
};

export class AppReveal {
  constructor(private readonly deps: AppRevealDeps) {}

  available(): boolean {
    return this.deps.platform === 'darwin';
  }

  reveal(): void {
    if (!this.available()) {
      return;
    }
    this.deps.shell.showItemInFolder(appBundlePath(this.deps.executablePath));
  }
}
