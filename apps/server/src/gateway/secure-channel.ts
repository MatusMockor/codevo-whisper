import {
  closeCodeFor,
  decodeClientMessage,
  encodeServerMessage,
  ProtocolError,
  type ClientMessage,
  type ErrorCode,
  type SecureTransport,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import WebSocket from 'ws';
import { closeSocket } from './close-socket';
import { CLOSE_NORMAL } from './limits';

export interface SecureChannel {
  send(message: ServerMessage): void;
  onMessage(handler: (message: ClientMessage) => void): void;
  onClose(handler: () => void): void;
  fail(code: ErrorCode, message?: string): void;
  close(code?: number): void;
  isOpen(): boolean;
}

export class WebSocketSecureChannel implements SecureChannel {
  private messageHandler: (message: ClientMessage) => void = () => this.fail('bad_message');
  private readonly closeListeners: Array<() => void> = [];
  private confirmed = false;
  private terminated = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly transport: SecureTransport,
    private readonly onConfirmed: () => void,
  ) {
    socket.once('close', () => this.terminate());
  }

  receive(ciphertext: Uint8Array): void {
    if (this.terminated) {
      return;
    }
    const message = this.decode(ciphertext);
    if (message === null) {
      return;
    }
    if (!this.confirmed) {
      this.confirmed = true;
      this.onConfirmed();
    }
    this.messageHandler(message);
  }

  send(message: ServerMessage): void {
    if (!this.isOpen()) {
      return;
    }
    this.socket.send(this.transport.seal(encodeServerMessage(message)));
  }

  onMessage(handler: (message: ClientMessage) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    if (this.terminated) {
      handler();
      return;
    }
    this.closeListeners.push(handler);
  }

  fail(code: ErrorCode, message: string = code): void {
    this.send({ type: 'error', code, message });
    this.close(closeCodeFor(code));
  }

  close(code = CLOSE_NORMAL): void {
    if (this.terminated) {
      return;
    }
    this.terminate();
    closeSocket(this.socket, code);
  }

  isOpen(): boolean {
    return !this.terminated && this.socket.readyState === WebSocket.OPEN;
  }

  private terminate(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    this.closeListeners.splice(0).forEach((listener) => listener());
  }

  private decode(ciphertext: Uint8Array): ClientMessage | null {
    try {
      return decodeClientMessage(this.transport.open(ciphertext));
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.fail('bad_message');
        return null;
      }
      throw error;
    }
  }
}
