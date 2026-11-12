import { readFile } from 'node:fs/promises';
import { expect } from 'vitest';

export async function spawnTimes(file: string): Promise<number[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map(Number);
}

export async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const present = await readFile(file, 'utf8').then(
      () => true,
      () => false,
    );
    if (present) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect.fail(`${file} was never written`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && isAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(isAlive(pid)).toBe(false);
}
