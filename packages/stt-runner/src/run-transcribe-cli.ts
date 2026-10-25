import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readTranscript } from './read-transcript';
import { runProcess } from './run-process';
import { withTempDir } from './temp-dir';
import { pcmToWav } from './wav';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 16_000;

export type TranscribeBackend = 'metal' | 'cpu' | 'vulkan';

export type TranscribeLanguage = 'sk' | 'en' | 'cs' | 'auto';

export type TranscribeCliOptions = {
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  language: TranscribeLanguage;
  pcm: Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function languageArgs(language: TranscribeLanguage): string[] {
  if (language === 'auto') {
    return [];
  }
  return ['--language', language];
}

function cliArgs(options: TranscribeCliOptions, wav: string, output: string): string[] {
  return [
    '--model',
    options.model,
    '--backend',
    options.backend,
    ...languageArgs(options.language),
    '--threads',
    String(options.threads),
    '--timestamps',
    'none',
    '--quiet',
    '--output',
    output,
    wav,
  ];
}

export async function runTranscribeCli(options: TranscribeCliOptions): Promise<string> {
  options.signal?.throwIfAborted();
  return withTempDir('codevo-stt-', async (dir) => {
    const wav = join(dir, 'audio.wav');
    const output = join(dir, 'transcript.txt');
    await writeFile(wav, pcmToWav(options.pcm), { mode: 0o600 });
    await runProcess(options.binary, cliArgs(options, wav, output), {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
    });
    const text = await readTranscript(output, MAX_OUTPUT_BYTES);
    options.signal?.throwIfAborted();
    return text;
  });
}
