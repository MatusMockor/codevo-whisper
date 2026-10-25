import {
  decodeServerMessage,
  encodeClientMessage,
  errorCodeForClose,
  ProtocolError,
  type ClientHandshake,
  type ClientMessage,
  type HandshakeResult,
  type SecureTransport,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import WebSocket from 'ws';

type Waiter = { resolve(message: Uint8Array): void; reject(error: Error): void };

export type SecureSocketOptions = { handshakeTimeoutMs?: number; maxQueuedMessages?: number };

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_QUEUED_MESSAGES = 256;

class FrameQueue {
  private readonly frames: Uint8Array[] = [];
  private readonly waiters: Waiter[] = [];
  private failure: Error | null = null;

  constructor(
    private readonly maxFrames: number,
    private readonly onOverflow: () => void,
  ) {}

  push(frame: Uint8Array): void {
    if (this.failure !== null) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(frame);
      return;
    }
    if (this.frames.length >= this.maxFrames) {
      this.frames.length = 0;
      this.fail(new Error('too many unread messages from the server'));
      this.onOverflow();
      return;
    }
    this.frames.push(frame);
  }

  fail(error: Error): void {
    this.failure ??= error;
    this.waiters.splice(0).forEach((waiter) => waiter.reject(error));
  }

  next(): Promise<Uint8Array> {
    const frame = this.frames.shift();
    if (frame !== undefined) {
      return Promise.resolve(frame);
    }
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

function closeError(code: number): Error {
  const errorCode = errorCodeForClose(code);
  if (errorCode === null) {
    return new Error(`the server closed the connection (${code})`);
  }
  return new ProtocolError(errorCode);
}

export class SecureSocket {
  private constructor(
    private readonly socket: WebSocket,
    private readonly queue: FrameQueue,
    private readonly transport: SecureTransport,
    readonly handshake: HandshakeResult,
  ) {}

  static async connect(endpoint: string, clientHandshake: ClientHandshake, options: SecureSocketOptions = {}): Promise<SecureSocket> {
    const socket = new WebSocket(endpoint, { perMessageDeflate: false, maxPayload: 65_536 });
    const queue = new FrameQueue(options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES, () => socket.terminate());
    socket.on('message', (data: Buffer) => queue.push(new Uint8Array(data)));
    socket.on('close', (code) => queue.fail(closeError(code)));
    socket.on('error', (error) => queue.fail(error));
    const deadline = setTimeout(() => {
      queue.fail(new Error('the handshake timed out'));
      socket.terminate();
    }, options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        socket.once('error', reject);
      });
      socket.send(clientHandshake.openingFrame);
      const completed = clientHandshake.complete(await queue.next());
      return new SecureSocket(socket, queue, completed.transport, completed.handshake);
    } catch (error) {
      socket.terminate();
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  send(message: ClientMessage): void {
    this.socket.send(this.transport.seal(encodeClientMessage(message)));
  }

  async next(): Promise<ServerMessage> {
    return decodeServerMessage(this.transport.open(await this.queue.next()));
  }

  close(): void {
    this.socket.close();
  }
}
