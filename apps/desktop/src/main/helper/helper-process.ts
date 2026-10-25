import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { consoleLogger, type Logger } from '../logging/logger';
import type { HelperArgs, HelperChannel, HelperMessage } from './helper-channel';
import { Listeners } from './listeners';

export type HelperCommand = { file: string; args: readonly string[] };

export type HelperProcessOptions = { logger?: Logger; timeoutMs?: number };

type Pending = {
  cmd: string;
  resolve: (message: HelperMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_RESTARTS = 1;
const STOP_GRACE_MS = 1000;

function unavailable(): Promise<ChildProcessWithoutNullStreams> {
  const failed = Promise.reject(new Error('helper-unavailable'));
  failed.catch(() => undefined);
  return failed;
}

function isRunning(child: ChildProcessWithoutNullStreams | null): child is ChildProcessWithoutNullStreams {
  return child !== null && child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function parseLine(line: string): HelperMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as HelperMessage) : null;
  } catch {
    return null;
  }
}

export class HelperProcess implements HelperChannel {
  private live: Promise<ChildProcessWithoutNullStreams> = unavailable();
  private child: ChildProcessWithoutNullStreams | null = null;
  private restartsLeft = 0;
  private stopping = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly events: Listeners<HelperMessage>;
  private readonly restarts: Listeners<void>;

  constructor(
    private readonly command: HelperCommand,
    options: HelperProcessOptions = {},
  ) {
    this.logger = options.logger ?? consoleLogger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.events = new Listeners(this.logger, 'Input helper event listener failed');
    this.restarts = new Listeners(this.logger, 'Input helper restart listener failed');
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.restartsLeft = MAX_RESTARTS;
    this.live = this.spawnChild();
    await this.live;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.live = unavailable();
    const child = this.child;
    if (!isRunning(child)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }

  async request(cmd: string, args: HelperArgs = {}, timeoutMs = this.timeoutMs): Promise<HelperMessage> {
    const child = await this.live;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, null), timeoutMs);
      this.pending.set(id, { cmd, resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  }

  onEvent(listener: (event: HelperMessage) => void): () => void {
    return this.events.add(listener);
  }

  onRestart(listener: () => void): () => void {
    return this.restarts.add(listener);
  }

  private spawnChild(): Promise<ChildProcessWithoutNullStreams> {
    const child = spawn(this.command.file, [...this.command.args], { stdio: 'pipe' });
    this.child = child;
    let markReady: () => void = () => undefined;
    const ready = new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('helper-ready-timeout'));
        child.kill('SIGKILL');
      }, this.timeoutMs);
      markReady = () => {
        clearTimeout(timer);
        resolve(child);
      };
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
        this.logger.error('Input helper process failed', error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('helper-exited'));
      });
    });
    child.stdin.on('error', (error) => this.logger.error('Input helper stdin failed', error));
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line, markReady));
    createInterface({ input: child.stderr }).on('line', (line) => this.logger.error('Input helper stderr', line));
    child.once('exit', (code, signal) => this.handleExit(child, { code, signal }));
    return ready;
  }

  private handleLine(line: string, markReady: () => void): void {
    const message = parseLine(line);
    if (!message) {
      this.logger.error('Input helper sent an invalid line', line);
      return;
    }
    if (typeof message['id'] === 'number') {
      this.settle(message['id'], message);
      return;
    }
    if (message['event'] === 'ready') {
      markReady();
      return;
    }
    this.events.emit(message);
  }

  private settle(id: number, message: HelperMessage | null): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!message) {
      pending.reject(new Error(`helper-timeout:${pending.cmd}`));
      return;
    }
    if (typeof message['error'] === 'string') {
      pending.reject(new Error(`helper-error:${pending.cmd}:${message['error']}`));
      return;
    }
    pending.resolve(message);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private handleExit(child: ChildProcessWithoutNullStreams, exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (child !== this.child) {
      return;
    }
    this.child = null;
    this.rejectPending(new Error('helper-exited'));
    if (this.stopping) {
      return;
    }
    if (this.restartsLeft <= 0) {
      this.logger.error('Input helper crashed again and stays stopped', exit);
      this.live = unavailable();
      return;
    }
    this.restartsLeft -= 1;
    this.logger.error('Input helper crashed, restarting', exit);
    this.restart();
  }

  private restart(): void {
    this.live = this.spawnChild();
    this.live.then(
      () => this.restarts.emit(),
      (error: unknown) => this.logger.error('Input helper restart failed', error),
    );
  }
}
