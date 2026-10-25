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
import { CLOSE_NORMAL } from './limits';

export interface SecureChannel {
  send(message: ServerMessage): void;
  onMessage(handler: (message: ClientMessage) => void): void;
  onClose(handler: () => void): void;
  fail(code: ErrorCode, message?: string): void;
  close(): void;
  isOpen(): boolean;
}

export class WebSocketSecureChannel implements SecureChannel {
  private messageHandler: (message: ClientMessage) => void = () => this.fail('bad_message');
  private confirmed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly transport: SecureTransport,
    private readonly onConfirmed: () => void,
  ) {}

  receive(ciphertext: Uint8Array): void {
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
    this.socket.once('close', handler);
  }

  fail(code: ErrorCode, message: string = code): void {
    this.send({ type: 'error', code, message });
    this.socket.close(closeCodeFor(code));
  }

  close(): void {
    this.socket.close(CLOSE_NORMAL);
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
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
