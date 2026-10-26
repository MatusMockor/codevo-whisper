import type { TranscribeBackend } from '@codevo-whisper/stt-runner';

export type SttEngine = 'worker' | 'cli';

export type SttConfig = {
  engine: SttEngine;
  workerBinary: string;
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  port: number;
  host: string;
};

const BACKENDS: readonly TranscribeBackend[] = ['vulkan', 'metal', 'cpu'];
const ENGINES: readonly SttEngine[] = ['worker', 'cli'];

function value(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: string, range: { min: number; max: number }): number {
  const raw = value(env, key, fallback);
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || parsed < range.min || parsed > range.max) {
    throw new Error(`${key} must be an integer between ${range.min} and ${range.max}, got "${raw}"`);
  }
  return parsed;
}

function choice<T extends string>(env: NodeJS.ProcessEnv, key: string, choices: readonly T[]): T {
  const raw = value(env, key, choices[0] ?? '');
  const match = choices.find((candidate) => candidate === raw);
  if (match === undefined) {
    throw new Error(`${key} must be one of ${choices.join(', ')}, got "${raw}"`);
  }
  return match;
}

export function loadSttConfig(env: NodeJS.ProcessEnv): SttConfig {
  return {
    engine: choice(env, 'STT_ENGINE', ENGINES),
    workerBinary: value(env, 'STT_WORKER_BINARY', '/opt/transcribe/bin/cw-stt-worker'),
    binary: value(env, 'STT_BINARY', '/opt/transcribe/bin/transcribe-cli'),
    model: value(env, 'STT_MODEL_PATH', '/models/parakeet-ultra-F16.gguf'),
    backend: choice(env, 'STT_BACKEND', BACKENDS),
    threads: integer(env, 'STT_THREADS', '4', { min: 1, max: 256 }),
    port: integer(env, 'STT_PORT', '8001', { min: 0, max: 65535 }),
    host: value(env, 'STT_HOST', '0.0.0.0'),
  };
}
