import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_CHARS = 64;
const FALLBACK = 'Codevo Whisper';

export function sanitizeDeviceName(text: string): string {
  const cleaned = text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  return [...cleaned].slice(0, MAX_CHARS).join('').trim();
}

async function macComputerName(): Promise<string> {
  try {
    const { stdout } = await run('scutil', ['--get', 'ComputerName'], { timeout: 2000 });
    return stdout;
  } catch {
    return '';
  }
}

export async function computerName(platform: NodeJS.Platform = process.platform): Promise<string> {
  const named = platform === 'darwin' ? sanitizeDeviceName(await macComputerName()) : '';
  if (named !== '') {
    return named;
  }
  const host = sanitizeDeviceName(hostname().replace(/\.local$/, ''));
  return host === '' ? FALLBACK : host;
}
