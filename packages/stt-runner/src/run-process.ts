import { spawn } from 'node:child_process';
import { TranscribeCliError } from './transcribe-cli-error';

const STDERR_LIMIT = 4000;

export type ProcessLimits = { timeoutMs: number; signal?: AbortSignal | undefined };

type Ending = { kind: 'closed'; code: number | null } | { kind: 'failed'; error: Error } | { kind: 'timeout' } | { kind: 'aborted' };

function appendTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
}

function toResult(ending: Ending, stderr: string, limits: ProcessLimits): void {
  if (ending.kind === 'aborted') {
    throw limits.signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
  if (ending.kind === 'timeout') {
    throw new TranscribeCliError('timeout', `transcribe-cli timed out after ${limits.timeoutMs} ms`);
  }
  if (ending.kind === 'failed') {
    throw new TranscribeCliError('spawn', `transcribe-cli could not start: ${ending.error.message}`);
  }
  if (ending.code !== 0) {
    throw new TranscribeCliError('exit', `transcribe-cli exited with ${ending.code ?? 'a signal'}: ${stderr.trim()}`);
  }
}

export async function runProcess(binary: string, args: string[], limits: ProcessLimits): Promise<void> {
  limits.signal?.throwIfAborted();
  let stderr = '';
  let stopped: Ending | null = null;
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const stop = (ending: Ending): void => {
    stopped ??= ending;
    child.kill('SIGKILL');
  };
  const onAbort = (): void => stop({ kind: 'aborted' });
  const timer = setTimeout(() => stop({ kind: 'timeout' }), limits.timeoutMs);
  limits.signal?.addEventListener('abort', onAbort, { once: true });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = appendTail(stderr, chunk);
  });
  const ending = await new Promise<Ending>((resolve) => {
    child.once('error', (error) => resolve({ kind: 'failed', error }));
    child.once('close', (code) => resolve({ kind: 'closed', code }));
  });
  clearTimeout(timer);
  limits.signal?.removeEventListener('abort', onAbort);
  toResult(stopped ?? ending, stderr, limits);
}
