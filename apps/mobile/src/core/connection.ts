import {
  decodeServerMessage,
  encodeClientMessage,
  errorCodeForClose,
  type ClientHandshake,
  type ClientMessage,
  type CompletedHandshake,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import type { SessionChannel } from './session';

export interface Wire {
  readonly bufferedAmount: number;
  send(bytes: Uint8Array): void;
  close(): void;
  subscribe(events: { open(): void; frame(data: unknown): void; failed(): void; closed(code: number): void }): void;
}
export type OpenWire = (endpoint: string) => Wire;

export class MobileConnection implements SessionChannel {
  private completed: CompletedHandshake | undefined;
  private queue: ServerMessage[] = [];
  private receiver: ((message: ServerMessage) => void) | undefined;
  private onFailure: ((error: Error) => void) | undefined;
  private waiter: { resolve(message: ServerMessage): void; reject(error: Error): void } | undefined;
  private failure: Error | undefined;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: () => void = () => undefined;

  private constructor(
    private readonly wire: Wire,
    private readonly signal: AbortSignal,
  ) {}

  static connect(endpoint: string, handshake: ClientHandshake, open: OpenWire, signal: AbortSignal): Promise<MobileConnection> {
    if (signal.aborted) {
      return Promise.reject(new Error('Connection cancelled'));
    }
    const connection = new MobileConnection(open(endpoint), signal);
    return new Promise((resolve, reject) => {
      connection.abort = () => connection.fail(new Error('Connection cancelled'));
      connection.onFailure = reject;
      signal.addEventListener('abort', connection.abort, { once: true });
      connection.timer = setTimeout(() => connection.fail(new Error('Connection timed out')), 15_000);
      connection.wire.subscribe({
        open: () => {
          try {
            connection.wire.send(handshake.openingFrame);
          } catch {
            connection.fail(new Error('Connection lost'));
          }
        },
        frame: (data) => {
          if (connection.closed) {
            return;
          }
          try {
            if (!(data instanceof ArrayBuffer) || data.byteLength > 65_535) {
              throw new Error('Invalid server frame');
            }
            const frame = new Uint8Array(data);
            if (connection.completed === undefined) {
              connection.completed = handshake.complete(frame);
              clearTimeout(connection.timer);
              connection.onFailure = undefined;
              resolve(connection);
              return;
            }
            connection.receive(decodeServerMessage(connection.completed.transport.open(frame)));
          } catch {
            connection.fail(new Error('Server authentication or protocol failed'));
          }
        },
        failed: () => connection.fail(new Error('Connection failed. Check server and network.')),
        closed: (code) => connection.fail(new Error(`Connection closed: ${errorCodeForClose(code) ?? 'network'}`)),
      });
    });
  }

  get bufferedAmount(): number {
    return this.wire.bufferedAmount;
  }
  get handshakeFingerprint(): Uint8Array {
    if (this.completed === undefined) {
      throw new Error('Handshake incomplete');
    }
    return this.completed.handshake.handshakeHash;
  }

  send(message: ClientMessage): void {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    if (this.closed || this.completed === undefined) {
      throw new Error('Connection closed');
    }
    this.wire.send(this.completed.transport.seal(encodeClientMessage(message)));
  }

  next(timeoutMs = 15_000): Promise<ServerMessage> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    const message = this.queue.shift();
    if (message !== undefined) {
      return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      this.timer = setTimeout(() => this.fail(new Error('Server response timed out')), timeoutMs);
      this.waiter = {
        resolve: (message) => {
          clearTimeout(this.timer);
          resolve(message);
        },
        reject,
      };
    });
  }

  listen(receive: (message: ServerMessage) => void, failed: (error: Error) => void): void {
    this.receiver = receive;
    this.onFailure = failed;
    if (this.failure !== undefined) {
      failed(this.failure);
      return;
    }
    for (const message of this.queue.splice(0)) {
      receive(message);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.timer);
    this.signal.removeEventListener('abort', this.abort);
    this.queue = [];
    this.wire.close();
  }

  private receive(message: ServerMessage): void {
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter.resolve(message);
      return;
    }
    if (this.receiver !== undefined) {
      this.receiver(message);
      return;
    }
    if (this.queue.length >= 64) {
      this.fail(new Error('Too many server messages'));
      return;
    }
    this.queue.push(message);
  }

  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.failure = error;
    this.waiter?.reject(error);
    this.waiter = undefined;
    this.close();
    this.onFailure?.(error);
  }
}
