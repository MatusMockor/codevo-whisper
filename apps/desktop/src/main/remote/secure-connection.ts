import {
  decodeServerMessage,
  encodeClientMessage,
  errorCodeForClose,
  MAX_NOISE_MESSAGE,
  SecureTransport,
  type ClientHandshake,
  type ClientMessage,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import WebSocket from 'ws';
import { failureForCode, RemoteFailure } from './remote-failure';

export type ConnectionOptions = { handshakeTimeoutMs: number; keepAliveMs?: number; rekeyEvery?: number };

const DEFAULT_KEEP_ALIVE_MS = 10_000;
const MAX_QUEUED_MESSAGES = 256;
const MAX_PAYLOAD = MAX_NOISE_MESSAGE + 1;

type Waiter = { resolve(message: ServerMessage): void; reject(error: RemoteFailure): void };

function closeFailure(code: number, handshakeDone: boolean): RemoteFailure {
  const errorCode = errorCodeForClose(code);
  if (errorCode === null) {
    return new RemoteFailure(handshakeDone ? 'connection-lost' : 'offline', `the server closed the connection (${code})`);
  }
  if (!handshakeDone && errorCode === 'bad_message') {
    return new RemoteFailure('server-key-changed', 'the server could not read the handshake for the pinned key');
  }
  return new RemoteFailure(failureForCode(errorCode), errorCode);
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

class Handshaking {
  private readonly frames: Uint8Array[] = [];
  private waiter: { resolve(frame: Uint8Array): void; reject(error: RemoteFailure): void } | null = null;
  private failure: RemoteFailure | null = null;

  push(frame: Uint8Array): void {
    if (this.waiter === null) {
      this.frames.push(frame);
      return;
    }
    this.waiter.resolve(frame);
    this.waiter = null;
  }

  drain(): Uint8Array[] {
    return this.frames.splice(0);
  }

  fail(failure: RemoteFailure): void {
    this.failure ??= failure;
    this.waiter?.reject(this.failure);
    this.waiter = null;
  }

  next(): Promise<Uint8Array> {
    const frame = this.frames.shift();
    if (frame !== undefined) {
      return Promise.resolve(frame);
    }
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
}

export class SecureConnection {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Waiter[] = [];
  private messageListener: ((message: ServerMessage) => void) | null = null;
  private closeListener: ((failure: RemoteFailure) => void) | null = null;
  private failure: RemoteFailure | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private awaitingPong = false;

  private constructor(
    private readonly socket: WebSocket,
    private readonly transport: SecureTransport,
    readonly handshakeHash: Uint8Array,
    keepAliveMs: number,
    early: Uint8Array[],
  ) {
    socket.removeAllListeners('message');
    socket.removeAllListeners('close');
    socket.on('message', (data, isBinary) => this.receive(data, isBinary));
    socket.on('close', (code) => this.terminate(closeFailure(code, true), true));
    socket.on('pong', () => {
      this.awaitingPong = false;
    });
    this.keepAlive = setInterval(() => this.ping(), keepAliveMs);
    this.keepAlive.unref();
    early.forEach((frame) => this.receive(frame, true));
  }

  static async open(endpoint: string, handshake: ClientHandshake, options: ConnectionOptions): Promise<SecureConnection> {
    const socket = new WebSocket(endpoint, { perMessageDeflate: false, maxPayload: MAX_PAYLOAD, handshakeTimeout: options.handshakeTimeoutMs });
    const pending = new Handshaking();
    socket.on('error', (error) => pending.fail(new RemoteFailure('offline', error.message, { cause: error })));
    socket.on('close', (code) => pending.fail(closeFailure(code, false)));
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        pending.fail(new RemoteFailure('protocol', 'the server sent a text frame'));
        return;
      }
      pending.push(toBytes(data));
    });
    const deadline = setTimeout(() => pending.fail(new RemoteFailure('timeout', 'the server did not answer the handshake in time')), options.handshakeTimeoutMs);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve());
        pending.next().catch(reject);
      });
      socket.send(handshake.openingFrame);
      const completed = complete(handshake, await pending.next());
      const transport = options.rekeyEvery === undefined ? completed.transport : new SecureTransport(completed.handshake, options.rekeyEvery);
      return new SecureConnection(socket, transport, completed.handshake.handshakeHash, options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS, pending.drain());
    } catch (error) {
      socket.terminate();
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  send(message: ClientMessage): void {
    if (this.failure !== null) {
      return;
    }
    this.socket.send(this.transport.seal(encodeClientMessage(message)));
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.messageListener = listener;
    for (const message of this.queue.splice(0)) {
      listener(message);
    }
  }

  onClose(listener: (failure: RemoteFailure) => void): void {
    this.closeListener = listener;
  }

  next(timeoutMs: number): Promise<ServerMessage> {
    const message = this.queue.shift();
    if (message !== undefined) {
      return Promise.resolve(message);
    }
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new RemoteFailure('timeout', 'the server did not answer in time'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close(): void {
    this.terminate(new RemoteFailure('connection-lost', 'the connection was closed'), false);
    this.socket.close();
  }

  private receive(data: WebSocket.RawData | Uint8Array, isBinary: boolean): void {
    if (this.failure !== null) {
      return;
    }
    if (!isBinary) {
      this.abort(new RemoteFailure('protocol', 'the server sent a text frame'));
      return;
    }
    const message = this.decode(data instanceof Uint8Array ? data : toBytes(data));
    if (message === null) {
      return;
    }
    this.deliver(message);
  }

  private decode(frame: Uint8Array): ServerMessage | null {
    try {
      return decodeServerMessage(this.transport.open(frame));
    } catch (error) {
      this.abort(new RemoteFailure('protocol', 'the server sent an invalid message', { cause: error }));
      return null;
    }
  }

  private deliver(message: ServerMessage): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(message);
      return;
    }
    if (this.messageListener !== null) {
      this.messageListener(message);
      return;
    }
    if (this.queue.length >= MAX_QUEUED_MESSAGES) {
      this.abort(new RemoteFailure('protocol', 'too many unread messages from the server'));
      return;
    }
    this.queue.push(message);
  }

  private ping(): void {
    if (this.awaitingPong) {
      this.abort(new RemoteFailure('connection-lost', 'the server stopped answering'));
      return;
    }
    this.awaitingPong = true;
    this.socket.ping();
  }

  private abort(failure: RemoteFailure): void {
    this.terminate(failure, true);
    this.socket.terminate();
  }

  private terminate(failure: RemoteFailure, notify: boolean): void {
    if (this.failure !== null) {
      return;
    }
    this.failure = failure;
    if (this.keepAlive !== null) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    this.waiters.splice(0).forEach((waiter) => waiter.reject(failure));
    if (!notify) {
      return;
    }
    this.closeListener?.(failure);
  }
}

function complete(handshake: ClientHandshake, reply: Uint8Array): ReturnType<ClientHandshake['complete']> {
  try {
    return handshake.complete(reply);
  } catch (error) {
    throw new RemoteFailure('server-key-changed', 'the server could not prove the pinned key', { cause: error });
  }
}
