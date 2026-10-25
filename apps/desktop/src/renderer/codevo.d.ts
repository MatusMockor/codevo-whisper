import type { IpcApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    readonly codevo: IpcApi;
  }
}
