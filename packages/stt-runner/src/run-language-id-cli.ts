import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_LANGUAGE_ID_CLI_OUTPUT_BYTES, parseLanguageIdCliOutput } from './language-id-cli-output';
import { assertLanguageSet, type LanguageCode, type LanguageScore } from './languages';
import { readTranscript } from './read-transcript';
import { runProcess } from './run-process';
import { DEFAULT_TIMEOUT_MS, type TranscribeBackend } from './run-transcribe-cli';
import { withTempDir } from './temp-dir';
import { pcmToWav } from './wav';

export type LanguageIdCliOptions = {
  binary: string;
  model: string;
  backend: TranscribeBackend;
  threads: number;
  allowed: readonly LanguageCode[];
  pcm: Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function cliArgs(options: LanguageIdCliOptions, wav: string, output: string): string[] {
  return [
    '--model',
    options.model,
    '--backend',
    options.backend,
    '--threads',
    String(options.threads),
    '--allow',
    options.allowed.join(','),
    '--top',
    '0',
    '--quiet',
    '--output',
    output,
    wav,
  ];
}

export async function runLanguageIdCli(options: LanguageIdCliOptions): Promise<LanguageScore[]> {
  options.signal?.throwIfAborted();
  assertLanguageSet(options.allowed);
  return withTempDir('codevo-langid-', async (dir) => {
    const wav = join(dir, 'audio.wav');
    const output = join(dir, 'candidates.txt');
    await writeFile(wav, pcmToWav(options.pcm), { mode: 0o600 });
    await runProcess(options.binary, cliArgs(options, wav, output), {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
    });
    const text = await readTranscript(output, MAX_LANGUAGE_ID_CLI_OUTPUT_BYTES);
    options.signal?.throwIfAborted();
    return parseLanguageIdCliOutput(text, options.allowed);
  });
}
