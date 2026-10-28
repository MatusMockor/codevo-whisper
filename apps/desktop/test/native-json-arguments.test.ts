import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
      expect(result.stdout.trim()).toBe('PASS native JSON argument identity');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
