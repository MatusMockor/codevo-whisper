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

const LANGUAGES_WARNING = 'Výber jazykov nebude dostupný, stiahnite Canary 1B v2 a rozpoznávanie jazyka v aplikácii\n';
const desktopCanary = () => join(home, '.config/Codevo Whisper/models/canary-1b-v2-q8.gguf');
const desktopLanguageId = () => join(home, '.config/Codevo Whisper/models/langid-voxlingua107-q8.gguf');
const managedCanary = () => join(home, '.local/share/codevo-whisper-server/models/canary-1b-v2-Q8_0.gguf');
const managedLanguageId = () => join(home, '.local/share/codevo-whisper-server/models/lang-id-voxlingua107-ecapa-Q8_0.gguf');

function addDesktopLanguageModels(): void {
  write(desktopCanary(), 'canary v1', 0o600);
  write(desktopLanguageId(), 'langid v1', 0o600);
}

function rerun(env: Record<string, string> = {}) {
  return spawnSync(join(repo, 'scripts', 'install-server-service.sh'), [], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, STT_MODEL_PATH: join(home, 'model.gguf'), ...env },
  });
}

describe('install-server-service.sh', () => {
  it('installs the bundles, env file, units and wrapper outside the checkout', () => {
    addDesktopLanguageModels();
    const result = install({ CW_PUBLIC_ENDPOINT: 'wss://host.ts.net' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(join(home, '.local/share/codevo-whisper-server/server/main.js'))).toBe(true);
    expect(existsSync(join(home, '.local/share/codevo-whisper-server/stt/main.js'))).toBe(true);
    const env = read('.config/codevo-whisper-server/env');
    expect(env).toContain('CW_PUBLIC_ENDPOINT="wss://host.ts.net"\n');
    expect(env).toContain(`CW_ADMIN_SOCKET="${home}/.local/state/codevo-whisper-server/admin.sock"\n`);
    expect(env).toContain(`STT_MODEL_PATH="${home}/model.gguf"\n`);
    expect(env).toContain(`STT_CONDITIONED_MODEL_PATH="${managedCanary()}"\n`);
    expect(env).toContain(`STT_LID_MODEL_PATH="${managedLanguageId()}"\n`);
    expect(readFileSync(managedCanary(), 'utf8')).toBe('canary v1');
    expect(readFileSync(managedLanguageId(), 'utf8')).toBe('langid v1');
    expect(mode(managedCanary())).toBe(0o644);
    expect(mode(managedLanguageId())).toBe(0o644);
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

  it('runs its own copy of the worker and language models so removing the desktop app keeps the service working', () => {
    write(join(home, 'worker'), 'worker v1', 0o755);
    addDesktopLanguageModels();
    expect(install().status).toBe(0);
    rmSync(join(home, 'worker'));
    rmSync(join(home, '.config/Codevo Whisper'), { recursive: true });

    const result = rerun();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const worker = join(home, '.local/share/codevo-whisper-server/bin/cw-stt-worker');
    expect(readFileSync(worker, 'utf8')).toBe('worker v1');
    expect(mode(worker)).toBe(0o755);
    expect(readFileSync(managedCanary(), 'utf8')).toBe('canary v1');
    expect(readFileSync(managedLanguageId(), 'utf8')).toBe('langid v1');
    const env = read('.config/codevo-whisper-server/env');
    expect(env).toContain(`STT_WORKER_BINARY="${worker}"\n`);
    expect(env).toContain(`STT_CONDITIONED_MODEL_PATH="${managedCanary()}"\n`);
    expect(env).toContain(`STT_LID_MODEL_PATH="${managedLanguageId()}"\n`);
  });

  it('warns that language selection is unavailable when a language model is missing and still installs', () => {
    write(desktopCanary(), 'canary v1');
    const result = install();

    expect(result.stderr).toBe(LANGUAGES_WARNING);
    expect(result.status).toBe(0);
    expect(readFileSync(managedCanary(), 'utf8')).toBe('canary v1');
    expect(existsSync(managedLanguageId())).toBe(false);
    expect(read('.config/codevo-whisper-server/env')).toContain(`STT_LID_MODEL_PATH="${managedLanguageId()}"\n`);
    expect(read('calls')).toContain('systemctl --user restart codevo-whisper-stt.service codevo-whisper-gateway.service\n');
  });

  it('picks up language models downloaded in the desktop app after the first install', () => {
    expect(install().stderr).toBe(LANGUAGES_WARNING);
    addDesktopLanguageModels();

    const result = rerun();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(managedCanary(), 'utf8')).toBe('canary v1');
    expect(readFileSync(managedLanguageId(), 'utf8')).toBe('langid v1');
  });

  it('replaces a managed language model with an explicitly given file', () => {
    addDesktopLanguageModels();
    expect(install().status).toBe(0);
    write(join(home, 'canary-v2.gguf'), 'canary v2');

    const result = rerun({ STT_CONDITIONED_MODEL_PATH: join(home, 'canary-v2.gguf') });

    expect(result.status).toBe(0);
    expect(readFileSync(managedCanary(), 'utf8')).toBe('canary v2');
    expect(read('.config/codevo-whisper-server/env')).toContain(`STT_CONDITIONED_MODEL_PATH="${managedCanary()}"\n`);
  });

  it.each([
    ['STT_CONDITIONED_MODEL_PATH', managedCanary, 'canary v1'],
    ['STT_LID_MODEL_PATH', managedLanguageId, 'langid v1'],
  ] as const)('refuses a reinstall when the explicitly given %s does not exist and keeps the managed model', (variable, managed, content) => {
    addDesktopLanguageModels();
    expect(install().status).toBe(0);
    const before = read('calls');
    const missing = join(home, 'missing-language-model.gguf');

    const result = rerun({ [variable]: missing });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`Súbor modelu zadaný v ${variable} neexistuje: ${missing}\n`);
    expect(readFileSync(managed(), 'utf8')).toBe(content);
    expect(read('calls')).toBe(before);
  });

  it('refuses to install without the model', () => {
    const result = install({ STT_MODEL_PATH: join(home, 'missing.gguf') });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`model not found: ${home}/missing.gguf`);
    expect(existsSync(calls)).toBe(false);
  });
});
