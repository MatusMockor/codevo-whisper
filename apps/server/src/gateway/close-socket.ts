import type WebSocket from 'ws';

const CLOSE_GRACE_MS = 2_000;

export function closeSocket(socket: WebSocket, code: number, reason?: string): void {
  socket.close(code, reason);
  setTimeout(() => socket.terminate(), CLOSE_GRACE_MS).unref();
}
