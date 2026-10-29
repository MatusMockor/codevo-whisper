import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
let dir: string;
let log: string;
let env: NodeJS.ProcessEnv;
function command(name: string, script: string): void {
  const path = join(dir, 'tools', name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`);
  chmodSync(path, 0o755);
}
function copy(path: string): string {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, path), target);
  chmodSync(target, 0o755);
  return target;
}
function run(path: string, ...args: string[]) {
  return spawnSync(copy(path), args, { encoding: 'utf8', env });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-delivery-'));
  mkdirSync(join(dir, 'tools'));
  log = join(dir, 'commands');
  env = { ...process.env, PATH: `${join(dir, 'tools')}:${process.env['PATH']}`, CW_COMMANDS: log };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it.each(['arm64', 'x64'])('builds and stages CLI and worker together for %s with the release flags and at most six jobs', (arch) => {
  command('uname', 'echo Darwin');
  command('git', 'echo 8facde6fcd8fb9caa585a5788ab450df6e8ec7db');
  command('cmake', `printf '%s\\n' "$*" >> "$CW_COMMANDS"
if [[ "$1" == --build ]]; then
  build="$2"
  shift 2
  mkdir -p "$build/bin"
  for target in "$@"; do
    if [[ "$target" == transcribe-cli || "$target" == cw-stt-worker ]]; then echo executable > "$build/bin/$target"; fi
  done
fi`);
  copy('native/stt-worker/stt-worker.cmake');
  const result = run('native/transcribe/build.sh', arch);
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(dir, 'apps/desktop/resources/bin', arch, 'cw-stt-worker'), 'utf8')).toBe('executable\n');
  expect(readFileSync(join(dir, 'apps/desktop/resources/bin', arch, 'transcribe-cli'), 'utf8')).toBe('executable\n');
  const calls = readFileSync(log, 'utf8');
  expect(calls).toContain('-DCMAKE_PROJECT_transcribe_INCLUDE=');
  expect(calls).toContain('-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0');
  expect(calls).toContain('-DTRANSCRIBE_BUILD_SHARED=OFF');
  expect(calls).toContain('-DBUILD_SHARED_LIBS=OFF');
  expect(calls).toContain('-DCMAKE_C_FLAGS=-fstack-protector-strong');
  expect(calls).toContain('-DCMAKE_CXX_FLAGS=-fstack-protector-strong');
  expect(calls).toContain('-DGGML_METAL_EMBED_LIBRARY=ON');
  expect(calls).toContain('--target transcribe-cli cw-stt-worker --parallel 6');
});

it('signs and verifies the worker identifier and requires its packaged binary', () => {
  const bin = join(dir, 'apps/desktop/resources/bin/arm64');
  mkdirSync(bin, { recursive: true });
  for (const name of ['transcribe-cli', 'cw-stt-worker', 'codevo-input-helper']) writeFileSync(join(bin, name), 'binary');
  command('codesign', `printf '%s\\n' "$*" >> "$CW_COMMANDS"
file="\${!#}"
[[ -e "$file" ]] || exit 1
if [[ "$1" == --display ]]; then
  case "$file" in
    *cw-stt-worker) id=app.codevo.whisper.stt-worker;;
    *transcribe-cli) id=app.codevo.whisper.transcribe-cli;;
    *codevo-input-helper) id=app.codevo.whisper.input-helper;;
    *) id=app.codevo.whisper;;
  esac
  printf 'Identifier=%s\\nTeamIdentifier=U574W69TH6\\nflags=0x10000(runtime)\\nTimestamp=now\\n' "$id"
fi`);
  expect(run('scripts/release/sign-native.sh', 'arm64').status).toBe(0);
  expect(readFileSync(log, 'utf8')).toContain('--identifier app.codevo.whisper.stt-worker');
  const app = join(dir, 'App.app');
  const packaged = join(app, 'Contents/Resources/bin/arm64');
  mkdirSync(packaged, { recursive: true });
  for (const name of ['transcribe-cli', 'cw-stt-worker', 'codevo-input-helper']) copyFileSync(join(bin, name), join(packaged, name));
  expect(run('scripts/release/verify-signature.sh', app, 'arm64').status).toBe(0);
  expect(readFileSync(log, 'utf8')).toContain(`--display --verbose=4 ${join(packaged, 'cw-stt-worker')}`);
  command('lipo', '[[ -f "$1" ]]');
  command('vtool', 'echo "minos 13.0"');
  expect(run('scripts/release/verify-binaries.sh', app, 'arm64').status).toBe(0);
  rmSync(join(packaged, 'cw-stt-worker'));
  expect(run('scripts/release/verify-binaries.sh', app, 'arm64').status).toBe(1);
  expect(run('scripts/release/verify-signature.sh', app, 'arm64').status).toBe(1);
});
