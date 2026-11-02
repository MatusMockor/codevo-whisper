import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '..', 'install-server-service.sh');

let home = '';
let repo = '';
let bin = '';
let calls = '';

function write(path: string, content: string, mode = 0o644): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cw-server-service-'));
  repo = join(home, 'repo');
  bin = join(home, 'stub-bin');
  calls = join(home, 'calls');
  write(join(repo, 'scripts', 'install-server-service.sh'), readFileSync(script, 'utf8'), 0o755);
  write(join(repo, 'apps', 'server', 'dist', 'main.js'), '');
  write(join(repo, 'apps', 'server', 'dist', 'cli.js'), 'console.log(process.env.CW_ADMIN_SOCKET, process.argv.slice(2).join(" "));\n');
  write(join(repo, 'apps', 'stt', 'dist', 'main.js'), '');
  write(join(bin, 'systemctl'), `#!/bin/sh\necho "systemctl $*" >> "${calls}"\n`, 0o755);
  write(join(bin, 'pnpm'), `#!/bin/sh\necho "pnpm $*" >> "${calls}"\n`, 0o755);
  write(join(home, 'worker'), '', 0o755);
  write(join(home, 'model.gguf'), '');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function install(env: Record<string, string> = {}) {
  return spawnSync(join(repo, 'scripts', 'install-server-service.sh'), [], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, STT_WORKER_BINARY: join(home, 'worker'), STT_MODEL_PATH: join(home, 'model.gguf'), ...env },
  });
}

const mode = (path: string) => statSync(path).mode & 0o777;
const read = (path: string) => readFileSync(join(home, path), 'utf8');

describe('install-server-service.sh', () => {
  it('installs the bundles, env file, units and wrapper outside the checkout', () => {
    const result = install({ CW_PUBLIC_ENDPOINT: 'wss://host.ts.net' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(join(home, '.local/share/codevo-whisper-server/server/main.js'))).toBe(true);
    expect(existsSync(join(home, '.local/share/codevo-whisper-server/stt/main.js'))).toBe(true);
    const env = read('.config/codevo-whisper-server/env');
    expect(env).toContain('CW_PUBLIC_ENDPOINT="wss://host.ts.net"\n');
    expect(env).toContain(`CW_ADMIN_SOCKET="${home}/.local/state/codevo-whisper-server/admin.sock"\n`);
    expect(env).toContain(`STT_MODEL_PATH="${home}/model.gguf"\n`);
    expect(mode(join(home, '.config/codevo-whisper-server/env'))).toBe(0o600);
    expect(mode(join(home, '.local/state/codevo-whisper-server'))).toBe(0o700);
    const gateway = read('.config/systemd/user/codevo-whisper-gateway.service');
    expect(gateway).toContain('Requires=codevo-whisper-stt.service\nAfter=codevo-whisper-stt.service\n');
    expect(gateway).toContain(`ExecStart="${process.execPath}" "${home}/.local/share/codevo-whisper-server/server/main.js"`);
    expect(read('.config/systemd/user/codevo-whisper-stt.service')).toContain('Restart=on-failure');
    expect(read('calls')).toBe(
      [
        'pnpm --dir ' + repo + ' --filter @codevo-whisper/server --filter @codevo-whisper/stt build',
        'systemctl --user daemon-reload',
        'systemctl --user enable codevo-whisper-stt.service codevo-whisper-gateway.service',
        'systemctl --user restart codevo-whisper-stt.service codevo-whisper-gateway.service',
        '',
      ].join('\n'),
    );

    rmSync(repo, { recursive: true });
    const cli = spawnSync(join(home, '.local/bin/codevo-whisper-server'), ['revoke', 'abc'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
    expect(cli.stdout).toBe(`${home}/.local/state/codevo-whisper-server/admin.sock revoke abc\n`);
  });

  it('moves the pairing state of the old phone server launcher', () => {
    write(join(home, '.local/state/codevo-phone-server/data/server-key.json'), '{"key":1}', 0o600);
    chmodSync(join(home, '.local/state/codevo-phone-server/data'), 0o700);

    expect(install().status).toBe(0);

    const key = join(home, '.local/state/codevo-whisper-server/data/server-key.json');
    expect(readFileSync(key, 'utf8')).toBe('{"key":1}');
    expect(mode(key)).toBe(0o600);
    expect(mode(join(home, '.local/state/codevo-whisper-server/data'))).toBe(0o700);
  });

  it('keeps settings from the previous install unless overridden', () => {
    expect(install({ CW_PUBLIC_ENDPOINT: 'wss://host.ts.net', STT_THREADS: '8' }).status).toBe(0);
    expect(install({ STT_THREADS: '6' }).status).toBe(0);

    const env = read('.config/codevo-whisper-server/env');
    expect(env).toContain('CW_PUBLIC_ENDPOINT="wss://host.ts.net"\n');
    expect(env).toContain('STT_THREADS="6"\n');
  });

  it('refuses to install without the model', () => {
    const result = install({ STT_MODEL_PATH: join(home, 'missing.gguf') });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`model not found: ${home}/missing.gguf`);
    expect(existsSync(calls)).toBe(false);
  });
});
