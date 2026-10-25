import type { Socket } from 'node:net';
import type WebSocket from 'ws';
import { closeSocket } from './close-socket';
import { CLOSE_POLICY_VIOLATION } from './limits';
import type { PreAuthLimiter } from './pre-auth-limiter';

type Admitted = { ip: string; authenticated: boolean; deadline: NodeJS.Timeout; webSocket: WebSocket | null };

export class TcpAdmission {
  private readonly admitted = new Map<Socket, Admitted>();

  constructor(
    private readonly limiter: PreAuthLimiter,
    private readonly handshakeTimeoutMs: number,
  ) {}

  admit(socket: Socket): void {
    const ip = socket.remoteAddress ?? 'unknown';
    if (!this.limiter.tryAcquire(ip)) {
      socket.destroy();
      return;
    }
    const entry: Admitted = { ip, authenticated: false, webSocket: null, deadline: setTimeout(() => this.expire(entry, socket), this.handshakeTimeoutMs) };
    this.admitted.set(socket, entry);
    socket.once('close', () => {
      clearTimeout(entry.deadline);
      this.admitted.delete(socket);
      this.limiter.release(ip, entry.authenticated);
    });
  }

  attach(socket: Socket, webSocket: WebSocket): void {
    const entry = this.admitted.get(socket);
    if (entry === undefined) {
      webSocket.terminate();
      return;
    }
    entry.webSocket = webSocket;
  }

  confirm(socket: Socket): void {
    const entry = this.admitted.get(socket);
    if (entry === undefined || entry.authenticated) {
      return;
    }
    clearTimeout(entry.deadline);
    entry.authenticated = true;
    this.limiter.promote(entry.ip);
  }

  private expire(entry: Admitted, socket: Socket): void {
    if (entry.webSocket === null) {
      socket.destroy();
      return;
    }
    closeSocket(entry.webSocket, CLOSE_POLICY_VIOLATION);
  }
}
