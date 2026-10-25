import type { Socket } from 'node:net';
import { createInterface } from 'node:readline';

export class LineChannel {
  private readonly lines: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private ended = false;

  constructor(private readonly socket: Socket) {
    const reader = createInterface({ input: socket, crlfDelay: Infinity });
    reader.on('line', (line) => this.push(line));
    reader.on('close', () => this.end());
    socket.on('error', () => this.end());
  }

  send(value: object): void {
    if (this.socket.destroyed || !this.socket.writable) {
      return;
    }
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  nextLine(): Promise<string | null> {
    const line = this.lines.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    if (this.ended) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  onClose(listener: () => void): void {
    this.socket.once('close', listener);
  }

  close(): void {
    this.socket.end();
  }

  private push(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }

  private end(): void {
    this.ended = true;
    this.waiters.splice(0).forEach((waiter) => waiter(null));
  }
}
