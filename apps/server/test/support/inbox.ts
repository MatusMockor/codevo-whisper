import { errorCodeForClose, ProtocolError } from '@codevo-whisper/protocol';
import type WebSocket from 'ws';

export type CloseInfo = { code: number; reason: string };

export class Inbox {
  private readonly messages: Uint8Array[] = [];
  private readonly waiters: Array<{ resolve(message: Uint8Array): void; reject(error: unknown): void }> = [];
  private failure: Error | null = null;
  readonly closed: Promise<CloseInfo>;

  constructor(socket: WebSocket) {
    socket.on('message', (data: Buffer) => this.push(new Uint8Array(data)));
    this.closed = new Promise((resolve) => {
      socket.on('close', (code, reason) => {
        this.fail(closeError(code));
        resolve({ code, reason: reason.toString('utf8') });
      });
    });
  }

  next(): Promise<Uint8Array> {
    const message = this.messages.shift();
    if (message !== undefined) {
      return Promise.resolve(message);
    }
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private push(message: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(message);
      return;
    }
    this.messages.push(message);
  }

  private fail(error: Error): void {
    this.failure = error;
    this.waiters.splice(0).forEach((waiter) => waiter.reject(error));
  }
}

function closeError(code: number): Error {
  const errorCode = errorCodeForClose(code);
  if (errorCode === null) {
    return new Error(`socket closed with ${code}`);
  }
  return new ProtocolError(errorCode, `socket closed with ${errorCode}`);
}
