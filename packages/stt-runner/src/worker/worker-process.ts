import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { TranscribeCliError } from '../transcribe-cli-error';
import { WorkerReplyReader, type WorkerReply } from './worker-frames';

const STDERR_LIMIT = 4000;

type Pending = { resolve: (text: string) => void; reject: (error: Error) => void };

export type WorkerCommand = { binary: string; args: string[]; maxTextBytes: number };

export class WorkerProcess {
  readonly ready: Promise<void>;
  readonly terminated: Promise<void>;
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly reader: WorkerReplyReader;
  private readonly pending: Pending[] = [];
  private stderr = '';
  private started = false;
  private exited = false;
  private settleReady: { resolve: () => void; reject: (error: Error) => void } = { resolve: () => undefined, reject: () => undefined };

  constructor(command: WorkerCommand) {
    this.reader = new WorkerReplyReader(command.maxTextBytes);
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = { resolve, reject };
    });
    this.ready.catch(() => undefined);
    this.child = spawn(command.binary, command.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => undefined);
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
    });
    this.terminated = new Promise<void>((resolve) => {
      this.child.once('error', (error) => {
        this.fail(new TranscribeCliError('spawn', `transcribe worker could not start: ${error.message}`));
        resolve();
      });
      this.child.once('close', (code, signal) => {
        this.fail(this.exitError(code, signal));
        resolve();
      });
    });
  }

  get alive(): boolean {
    return !this.exited;
  }

  request(frame: Uint8Array): Promise<string> {
    if (this.exited) {
      return Promise.reject(new TranscribeCliError('exit', 'transcribe worker is not running'));
    }
    return new Promise<string>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(frame);
    });
  }

  kill(): void {
    this.child.stdin.end();
    this.child.kill('SIGKILL');
  }

  private onData(chunk: Buffer): void {
    try {
      this.reader.push(chunk).forEach((reply) => this.onReply(reply));
    } catch (error) {
      this.fail(error as Error);
      this.kill();
    }
  }

  private onReply(reply: WorkerReply): void {
    if (!this.started) {
      this.onStartReply(reply);
      return;
    }
    const pending = this.pending.shift();
    if (reply.status === 'ok') {
      pending?.resolve(reply.text);
      return;
    }
    pending?.reject(new TranscribeCliError('exit', `transcribe worker failed: ${reply.text}`));
  }

  private onStartReply(reply: WorkerReply): void {
    this.started = true;
    if (reply.status === 'ready') {
      this.settleReady.resolve();
      return;
    }
    this.fail(new TranscribeCliError('spawn', `transcribe worker could not start: ${reply.text}`));
    this.kill();
  }

  private exitError(code: number | null, signal: NodeJS.Signals | null): TranscribeCliError {
    const reason = this.started ? 'exit' : 'spawn';
    return new TranscribeCliError(reason, `transcribe worker exited with ${code ?? signal ?? 'unknown'}: ${this.stderr.trim()}`);
  }

  private fail(error: Error): void {
    this.exited = true;
    this.settleReady.reject(error);
    this.pending.splice(0).forEach((pending) => pending.reject(error));
  }
}
