import type WebSocket from 'ws';
import { CLOSE_GOING_AWAY } from './limits';

const SHUTDOWN_GRACE_MS = 500;

export async function closeClients(clients: Set<WebSocket>): Promise<void> {
  const open = [...clients];
  const closed = open.map((client) => new Promise<void>((resolve) => client.once('close', () => resolve())));
  open.forEach((client) => client.close(CLOSE_GOING_AWAY));
  const timer = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  await Promise.race([Promise.all(closed), timer]);
  open.forEach((client) => client.terminate());
}
