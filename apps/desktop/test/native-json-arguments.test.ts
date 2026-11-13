import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const native = fileURLToPath(new URL('../../../native/macos-helper/', import.meta.url));

describe.runIf(process.platform === 'darwin')('native JSON arguments', () => {
  it('preserves actual raw JSON numeric and boolean identities through the production converter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-native-json-'));
    try {
      const binary = join(dir, 'json-arguments');
      await execute('swiftc', ['-swift-version', '6', join(native, 'Sources/Output.swift'), join(native, 'Sources/NativeArguments.swift'), join(native, 'test/json-arguments/main.swift'), '-o', binary]);
      const result = await execute(binary);
      expect(result.stdout.trim().split('\n')).toEqual([
        'PASS native JSON argument identity',
        'PASS native session shortcut arguments',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('builds the complete helper without warnings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cw-native-build-'));
    try {
      const sources = (await readdir(join(native, 'Sources'))).filter((name) => name.endsWith('.swift'));
      const result = await execute('swiftc', [
        '-O', '-swift-version', '6', '-warnings-as-errors',
        '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
        '-framework', 'AppKit', '-framework', 'Carbon', '-framework', 'IOKit',
        '-framework', 'ApplicationServices', '-framework', 'CoreAudio',
        ...sources.map((name) => join(native, 'Sources', name)), '-o', join(dir, 'helper'),
      ]);
      expect(result.stderr).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
