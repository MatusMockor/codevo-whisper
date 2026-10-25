import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const FAKE_CLI = fileURLToPath(new URL('./fake-transcribe-cli.sh', import.meta.url));

export async function readRecordedCalls(file: string): Promise<string[][]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('--\n')
    .filter((call) => call.length > 0)
    .map((call) => call.trimEnd().split('\n'));
}
