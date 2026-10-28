export interface DesktopShell {
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): void;
}

export class RecordingDesktopShell implements DesktopShell {
  readonly opened: string[] = [];
  readonly revealed: string[] = [];

  openExternal(url: string): Promise<void> {
    this.opened.push(url);
    return Promise.resolve();
  }

  showItemInFolder(path: string): void {
    this.revealed.push(path);
  }
}
