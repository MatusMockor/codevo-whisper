import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const releaseDir = join(import.meta.dirname, '..', 'release');

let workDir = '';

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cw-release-shell-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function runScript(script: string, args: string[], env: Record<string, string>, cwd = workDir) {
  return spawnSync(join(releaseDir, script), args, { cwd, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: workDir, ...env } });
}

describe('resolve-version.sh', () => {
  const resolve = (env: Record<string, string>) => {
    const output = join(workDir, 'output');
    writeFileSync(output, '');
    const result = runScript('resolve-version.sh', [], { GITHUB_OUTPUT: output, ...env });
    return { status: result.status, stderr: result.stderr, output: readFileSync(output, 'utf8') };
  };

  it('takes the version from the tag on a push', () => {
    expect(resolve({ EVENT_NAME: 'push', REF_NAME: 'v1.2.0', INPUT_VERSION: '9.9.9' }).output).toBe('version=1.2.0\n');
  });

  it('takes the version from the input on a manual run', () => {
    expect(resolve({ EVENT_NAME: 'workflow_dispatch', INPUT_VERSION: '1.2.0-beta.1' }).output).toBe('version=1.2.0-beta.1\n');
  });

  it('rejects a version that is not semver', () => {
    const result = resolve({ EVENT_NAME: 'workflow_dispatch', INPUT_VERSION: '1.2; rm -rf /' });

    expect(result.status).toBe(1);
    expect(result.output).toBe('');
  });

  it('rejects a tag without the v prefix pattern', () => {
    expect(resolve({ EVENT_NAME: 'push', REF_NAME: 'release-1' }).status).toBe(1);
  });

  it('requires the event name', () => {
    expect(resolve({}).status).toBe(1);
  });
});

describe('verify-build-ref.sh', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

  function commit(cwd: string, message: string): string {
    git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-q', '-m', message);
    return git(cwd, 'rev-parse', 'HEAD');
  }

  function setUpClone(): { clone: string; mainSha: string; sideSha: string } {
    const origin = join(workDir, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    const mainSha = commit(origin, 'main');
    git(origin, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'tag', '-a', 'v1.2.0', '-m', 'release');
    git(origin, 'checkout', '-q', '-b', 'side');
    const sideSha = commit(origin, 'side');
    git(origin, 'tag', 'v1.3.0');
    git(origin, 'checkout', '-q', 'main');
    const clone = join(workDir, 'clone');
    git(workDir, 'clone', '-q', origin, clone);
    return { clone, mainSha, sideSha };
  }

  const verify = (clone: string, env: Record<string, string>) => runScript('verify-build-ref.sh', [], env, clone);

  it('accepts a tag on main that points to the build commit', () => {
    const { clone, mainSha } = setUpClone();

    expect(verify(clone, { EVENT_NAME: 'push', REF_NAME: 'v1.2.0', BUILD_SHA: mainSha }).status).toBe(0);
  });

  it('rejects a tag that points to another commit', () => {
    const { clone, sideSha } = setUpClone();
    const result = verify(clone, { EVENT_NAME: 'push', REF_NAME: 'v1.2.0', BUILD_SHA: sideSha });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not point to');
  });

  it('rejects a tag on a commit that is not on main', () => {
    const { clone, sideSha } = setUpClone();
    const result = verify(clone, { EVENT_NAME: 'push', REF_NAME: 'v1.3.0', BUILD_SHA: sideSha });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not on main');
  });

  it('accepts a manual run on main', () => {
    const { clone, mainSha } = setUpClone();

    expect(verify(clone, { EVENT_NAME: 'workflow_dispatch', REF_NAME: 'main', BUILD_SHA: mainSha }).status).toBe(0);
  });

  it('rejects a manual run from another branch', () => {
    const { clone, sideSha } = setUpClone();
    const result = verify(clone, { EVENT_NAME: 'workflow_dispatch', REF_NAME: 'side', BUILD_SHA: sideSha });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only from main');
  });
});

const hasClang = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'clang']).status === 0;

describe.runIf(hasClang)('verify-binaries.sh', () => {
  function binary(name: string, arch: 'arm64' | 'x86_64', minos: string): void {
    const source = join(workDir, 'main.c');
    writeFileSync(source, 'int main(void) { return 0; }\n');
    execFileSync('xcrun', ['clang', '-arch', arch, `-mmacosx-version-min=${minos}`, source, '-o', join(workDir, 'App.app', 'Contents', 'Resources', 'bin', arch === 'arm64' ? 'arm64' : 'x64', name)]);
  }

  function app(arch: 'arm64' | 'x64'): string {
    const dir = join(workDir, 'App.app', 'Contents', 'Resources', 'bin', arch);
    mkdirSync(dir, { recursive: true });
    return join(workDir, 'App.app');
  }

  const verify = (appPath: string, arch: string) => runScript('verify-binaries.sh', [appPath, arch], {});

  it('accepts binaries for the arch with minos 13.0', () => {
    const appPath = app('arm64');
    binary('codevo-input-helper', 'arm64', '13.0');
    binary('transcribe-cli', 'arm64', '12.0');
    binary('cw-stt-worker', 'arm64', '13.0');

    expect(verify(appPath, 'arm64').status).toBe(0);
  });

  it('rejects a binary that needs a newer macOS', () => {
    const appPath = app('arm64');
    binary('codevo-input-helper', 'arm64', '13.0');
    binary('transcribe-cli', 'arm64', '26.0');
    const result = verify(appPath, 'arm64');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('transcribe-cli: minos 26.0 > 13.0');
  });

  it('rejects a binary for the wrong arch', () => {
    const appPath = app('x64');
    binary('codevo-input-helper', 'x86_64', '13.0');
    execFileSync('xcrun', ['clang', '-arch', 'arm64', '-mmacosx-version-min=13.0', '-x', 'c', '-', '-o', join(appPath, 'Contents', 'Resources', 'bin', 'x64', 'transcribe-cli')], {
      input: 'int main(void) { return 0; }\n',
    });
    const result = verify(appPath, 'x64');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('transcribe-cli: no x86_64 slice');
  });

  it('rejects an app without both binaries', () => {
    const appPath = app('arm64');
    binary('codevo-input-helper', 'arm64', '13.0');
    const result = verify(appPath, 'arm64');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing');
  });
});
