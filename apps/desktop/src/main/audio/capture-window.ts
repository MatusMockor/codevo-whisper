import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
import { CAPTURE_CHANNELS, type CaptureRequest, type RawAudioDevice } from '../../shared/capture-contract';
import { Listeners } from '../helper/listeners';
import { isTrustedSenderUrl } from '../ipc/trusted-sender';
import type { Logger } from '../logging/logger';
import { loadSource } from '../windows/load-source';
import type { RendererSource } from '../windows/renderer-source';
import type { CaptureHost } from './capture-host';
import { parseDeviceList, parseFrame, parseLevel, parseReply } from './capture-payloads';
import { CaptureRequests } from './capture-requests';

const REQUEST_TIMEOUT_MS = 30_000;

function createHiddenWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/capture.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
}

export class CaptureWindow implements CaptureHost {
  private window: BrowserWindow | null = null;
  private ready: Promise<WebContents> | null = null;
  private readonly requests = new CaptureRequests();
  private readonly frames: Listeners<Uint8Array>;
  private readonly levels: Listeners<number>;
  private readonly devices: Listeners<RawAudioDevice[]>;

  constructor(
    private readonly source: RendererSource,
    private readonly logger: Logger,
  ) {
    this.frames = new Listeners(logger, 'A capture frame listener failed');
    this.levels = new Listeners(logger, 'A capture level listener failed');
    this.devices = new Listeners(logger, 'A capture device listener failed');
    this.listen(CAPTURE_CHANNELS.reply, (payload) => {
      this.requests.settle(parseReply(payload));
    });
    this.listen(CAPTURE_CHANNELS.frame, (payload) => {
      this.frames.emit(parseFrame(payload));
    });
    this.listen(CAPTURE_CHANNELS.level, (payload) => {
      this.levels.emit(parseLevel(payload));
    });
    this.listen(CAPTURE_CHANNELS.devices, (payload) => {
      this.devices.emit(parseDeviceList(payload));
    });
  }

  owns(window: BrowserWindow): boolean {
    return window === this.window;
  }

  isCaptureFrame(contents: WebContents | null, url: string | undefined): boolean {
    const window = this.window;
    if (contents === null || window === null || window.isDestroyed()) {
      return false;
    }
    return contents.id === window.webContents.id && isTrustedSenderUrl(url, this.source);
  }

  async request(request: CaptureRequest): Promise<unknown> {
    if (request.type === 'stop' && this.ready === null) {
      return null;
    }
    const contents = await this.ensure();
    const { id, promise } = this.requests.create(REQUEST_TIMEOUT_MS);
    contents.send(CAPTURE_CHANNELS.command, { ...request, id });
    return promise;
  }

  watchDevices(): void {
    this.ensure().catch((error: unknown) => {
      this.logger.error('The capture window could not be opened', error);
    });
  }

  discard(): void {
    const window = this.window;
    if (window === null) {
      return;
    }
    this.forget(window, new Error('The capture window was discarded'));
    window.destroy();
  }

  onFrame(listener: (pcm: Uint8Array) => void): () => void {
    return this.frames.add(listener);
  }

  onLevel(listener: (rms: number) => void): () => void {
    return this.levels.add(listener);
  }

  onDevices(listener: (devices: RawAudioDevice[]) => void): () => void {
    return this.devices.add(listener);
  }

  private ensure(): Promise<WebContents> {
    if (this.ready !== null) {
      return this.ready;
    }
    const window = createHiddenWindow();
    const contents = window.webContents;
    this.window = window;
    contents.once('render-process-gone', () => {
      this.forget(window, new Error('The capture renderer is gone'));
      window.destroy();
    });
    window.once('closed', () => {
      this.forget(window, new Error('The capture window was closed'));
    });
    this.ready = loadSource(window, this.source).then(
      () => contents,
      (error: unknown) => {
        this.forget(window, new Error('The capture page failed to load'));
        window.destroy();
        throw error;
      },
    );
    return this.ready;
  }

  private forget(window: BrowserWindow, reason: Error): void {
    if (this.window !== window) {
      return;
    }
    this.window = null;
    this.ready = null;
    this.requests.rejectAll(reason);
  }

  private listen(channel: string, handle: (payload: unknown) => void): void {
    ipcMain.on(channel, (event: IpcMainEvent, payload: unknown) => {
      if (!this.isTrustedEvent(event)) {
        this.logger.error('Rejected capture IPC from an untrusted sender', channel);
        return;
      }
      try {
        handle(payload);
      } catch (error) {
        this.logger.error('Rejected an invalid capture IPC payload', error);
      }
    });
  }

  private isTrustedEvent(event: IpcMainEvent): boolean {
    const frame = event.senderFrame;
    if (frame === null || frame.parent !== null) {
      return false;
    }
    return this.isCaptureFrame(event.sender, frame.url);
  }
}
