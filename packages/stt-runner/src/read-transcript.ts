import { open } from 'node:fs/promises';
import { TranscribeCliError } from './transcribe-cli-error';

async function openTranscript(file: string) {
  try {
    return await open(file, 'r');
  } catch {
    throw new TranscribeCliError('missing-output', 'transcribe-cli wrote no transcript');
  }
}

export async function readTranscript(file: string, maxBytes: number): Promise<string> {
  const handle = await openTranscript(file);
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      throw new TranscribeCliError('output-too-large', `transcript has ${size} bytes, limit is ${maxBytes}`);
    }
    const text = await handle.readFile({ encoding: 'utf8' });
    return text.trim();
  } finally {
    await handle.close();
  }
}
