export type AvailableUpdate = { version: string };

export interface AppUpdater {
  check(): Promise<AvailableUpdate | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  install(): Promise<void>;
}
