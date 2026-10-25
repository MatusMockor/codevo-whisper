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

class FrameQueue {
  private readonly frames: Uint8Array[] = [];
  private readonly waiters: Waiter[] = [];
  private failure: Error | null = null;

  push(frame: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(frame);
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

  static async connect(endpoint: string, clientHandshake: ClientHandshake): Promise<SecureSocket> {
    const socket = new WebSocket(endpoint, { perMessageDeflate: false, maxPayload: 65_536 });
    const queue = new FrameQueue();
    socket.on('message', (data: Buffer) => queue.push(new Uint8Array(data)));
    socket.on('close', (code) => queue.fail(closeError(code)));
    socket.on('error', (error) => queue.fail(error));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(clientHandshake.openingFrame);
    const completed = await queue.next().then((reply) => clientHandshake.complete(reply));
    return new SecureSocket(socket, queue, completed.transport, completed.handshake);
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
