import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';

export type SystemAudioEvents = { started(): void; failed(note: string): void };

export interface SystemAudioSource {
  start(output: Writable, events: SystemAudioEvents): void;
  stop(): Promise<void>;
}

const PW_RECORD_ARGS = ['-P', '{ stream.capture.sink=true }', '--rate', '16000', '--channels', '1', '--format', 's16', '-'];
const STOP_TIMEOUT_MS = 2000;

function spawnNote(error: Error): string {
  if ('code' in error && error.code === 'ENOENT') {
    return 'Zvuk systému sa nedá nahrať, chýba program pw-record (balík pipewire-bin). Nahráva sa iba mikrofón.';
  }
  return `Zvuk systému sa nedá nahrať, pw-record sa nespustil (${error.message}). Nahráva sa iba mikrofón.`;
}

export class PipeWireSystemAudio implements SystemAudioSource {
  private child: ChildProcess | null = null;
  private closed: Promise<void> = Promise.resolve();

  constructor(private readonly binary = 'pw-record') {}

  start(output: Writable, events: SystemAudioEvents): void {
    const child = spawn(this.binary, PW_RECORD_ARGS, { stdio: ['ignore', 'pipe', 'ignore'] });
    this.child = child;
    let reported = false;
    const fail = (note: string): void => {
      if (reported || this.child !== child) return;
      reported = true;
      events.failed(note);
    };
    this.closed = new Promise((resolve) => {
      child.once('close', () => resolve());
    });
    child.once('error', (error) => fail(spawnNote(error)));
    child.once('exit', (code, signal) => fail(`Nahrávanie zvuku systému skončilo (pw-record: ${code ?? signal ?? 'neznámy dôvod'}). Nahráva sa iba mikrofón.`));
    child.stdout?.once('data', () => events.started());
    child.stdout?.pipe(output, { end: false });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
    await this.closed;
    clearTimeout(timer);
  }
}
