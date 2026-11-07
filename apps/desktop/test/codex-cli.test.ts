import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCodex, codexProvider, findCodex } from '../src/main/ai/codex-cli';
import { LlmError } from '../src/main/ai/llm-client';

const FAKE_CODEX = fileURLToPath(new URL('./support/fake-codex.sh', import.meta.url));
const MESSAGES = [
  { role: 'system', content: 'Uprav diktát.' },
  { role: 'user', content: '{"transcript":"ehm zajtra o desiatej nie o jedenástej"}' },
] as const;

let dir: string;
let bin: string;
let home: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-codex-test-'));
  bin = join(dir, 'bin');
  home = join(dir, 'home');
  await mkdir(bin);
  await mkdir(home);
  await symlink(FAKE_CODEX, join(bin, 'codex'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(mode: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: home, FAKE_CODEX_DIR: dir, FAKE_CODEX_MODE: mode, ...extra };
}

function complete(mode: string, extra: Record<string, string> = {}, timeoutMs = 5_000, signal?: AbortSignal): Promise<string> {
  return codexProvider({ model: 'gpt-6-luna', effort: 'low', env: env(mode, extra) })(MESSAGES, { timeoutMs, ...(signal === undefined ? {} : { signal }) });
}

async function failure(run: Promise<unknown>): Promise<LlmError> {
  const error: unknown = await run.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LlmError);
  return error as LlmError;
}

async function recordedArgs(): Promise<string[]> {
  return (await readFile(join(dir, 'args'), 'utf8')).trimEnd().split('\n');
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('codexProvider', () => {
  it('runs one ephemeral read-only exec in an empty private directory, sends the prompt on stdin and returns the answer file', async () => {
    expect(await complete('answer', { FAKE_CODEX_ANSWER: 'Zajtra o jedenástej.' })).toBe('Zajtra o jedenástej.');

    const args = await recordedArgs();
    const workdir = args[args.indexOf('-C') + 1] ?? '';
    expect(args.slice(0, 9)).toEqual(['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--ignore-user-config', '--ignore-rules', '--color', 'never']);
    expect(args).toEqual(expect.arrayContaining(['-m', 'gpt-6-luna', '-c', 'model_reasoning_effort=low', '--disable', 'shell_tool', '--disable', 'unified_exec']));
    expect(args.at(-1)).toBe('-');
    expect(args[args.indexOf('-o') + 1]).toBe(join(workdir, 'answer.txt'));
    expect(args.join(' ')).not.toContain('jedenástej');
    expect(await readFile(join(dir, 'stdin'), 'utf8')).toBe(`Uprav diktát.\n\n${MESSAGES[1].content}`);
    expect(await readFile(join(dir, 'workdir-listing'), 'utf8')).toBe('');
    await expect(stat(workdir)).rejects.toThrow();
  });

  it('unwraps an answer echoed back as transcript JSON and strips reasoning blocks', async () => {
    expect(await complete('answer', { FAKE_CODEX_ANSWER: '{"transcript": "Zajtra o jedenástej."}' })).toBe('Zajtra o jedenástej.');
    expect(await complete('answer', { FAKE_CODEX_ANSWER: '<think>hmm</think> Ahoj.' })).toBe('Ahoj.');
    expect(await complete('answer', { FAKE_CODEX_ANSWER: '<think>x</think> {"transcript":"Ahoj."} ' })).toBe('Ahoj.');
    for (const json of ['{"transcript":"a","extra":1}', '{"transcript":7}', '{"transcript": "nedokonč']) {
      expect(await complete('answer', { FAKE_CODEX_ANSWER: json })).toBe(json);
    }
  });

  it('reports a logged-out CLI apart from any other failed run, a missing answer and an oversized one', async () => {
    expect((await failure(complete('logged-out'))).reason).toBe('codex-logged-out');
    expect((await failure(complete('fail'))).reason).toBe('codex-failed');
    expect((await failure(complete('no-output'))).reason).toBe('bad-response');
    expect((await failure(complete('oversize'))).reason).toBe('too-large');
  });

  it('never puts the prompt in the error it reports', async () => {
    const error = await failure(complete('logged-out'));
    expect(error.message).not.toContain('jedenástej');
  });

  it('reports a missing binary as not found', async () => {
    const empty = join(dir, 'empty');
    await mkdir(empty);
    const run = codexProvider({ model: 'gpt-6-luna', effort: 'low', env: { PATH: empty, HOME: empty } })(MESSAGES, { timeoutMs: 1_000 });
    expect((await failure(run)).reason).toBe('codex-not-found');
  });

  it('kills the CLI and everything it started when it does not answer in time', async () => {
    const started = Date.now();
    expect((await failure(complete('hang', {}, 300))).reason).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
    await expect.poll(() => isRunning(pid)).toBe(false);
  });

  it('reports a CLI that times out while logged out as logged out', async () => {
    expect((await failure(complete('hang-logged-out', {}, 300))).reason).toBe('codex-logged-out');
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
    await expect.poll(() => isRunning(pid)).toBe(false);
  });

  it('kills the CLI when the caller aborts and reports it apart from a timeout', async () => {
    const controller = new AbortController();
    const run = complete('hang', {}, 10_000, controller.signal);
    await expect.poll(() => readFile(join(dir, 'pid'), 'utf8').catch(() => '')).not.toBe('');
    controller.abort();
    expect((await failure(run)).reason).toBe('aborted');
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
    await expect.poll(() => isRunning(pid)).toBe(false);
  });

  it('does not start the CLI for a request that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await failure(complete('answer', {}, 1_000, controller.signal))).reason).toBe('aborted');
    await expect(stat(join(dir, 'args'))).rejects.toThrow();
  });
});

describe('findCodex', () => {
  it('prefers codex on PATH and otherwise finds it in a user install directory', async () => {
    expect(await findCodex({ PATH: bin, HOME: home })).toBe(join(bin, 'codex'));

    const empty = join(dir, 'empty');
    await mkdir(empty);
    for (const installDir of ['.local/bin', '.nvm/versions/node/v24.16.0/bin']) {
      const target = join(home, installDir);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'codex'), '#!/bin/sh\n');
      await chmod(join(target, 'codex'), 0o755);
      expect(await findCodex({ PATH: empty, HOME: home })).toBe(join(target, 'codex'));
      await rm(join(target, 'codex'));
    }
    expect(await findCodex({ PATH: empty, HOME: home })).toBeNull();
  });
});

describe('checkCodex', () => {
  it('passes when the CLI is logged in and answers one prompt', async () => {
    expect(await checkCodex({ model: 'gpt-6-luna', effort: 'low', env: env('answer') })).toEqual({ ok: true });
    expect(await readFile(join(dir, 'stdin'), 'utf8')).not.toBe('');
  });

  it('reports a logged-out CLI without sending a prompt, and a missing one as not found', async () => {
    expect(await checkCodex({ model: 'gpt-6-luna', effort: 'low', env: env('logged-out') })).toEqual({ ok: false, error: 'codex-logged-out' });
    await expect(stat(join(dir, 'args'))).rejects.toThrow();
    expect(await checkCodex({ model: 'gpt-6-luna', effort: 'low', env: { PATH: join(dir, 'none'), HOME: join(dir, 'none') } })).toEqual({ ok: false, error: 'codex-not-found' });
  });

  it.each(['login-hang', 'hang'])('stops a cancelled check in %s and removes its private directory', async (mode) => {
    const controller = new AbortController();
    const check = checkCodex({ model: 'gpt-6-luna', effort: 'low', env: env(mode) }, controller.signal);
    await expect.poll(() => readFile(join(dir, 'pid'), 'utf8').catch(() => '')).not.toBe('');
    controller.abort();
    expect(await check).toEqual({ ok: false, error: 'aborted' });
    const pid = Number(await readFile(join(dir, 'pid'), 'utf8'));
    await expect.poll(() => isRunning(pid)).toBe(false);
    if (mode === 'hang') {
      const args = await recordedArgs();
      await expect(stat(args[args.indexOf('-C') + 1] ?? '')).rejects.toThrow();
    }
  });

  it('reports a failed run of the CLI', async () => {
    expect(await checkCodex({ model: 'gpt-6-luna', effort: 'low', env: env('fail') })).toEqual({ ok: false, error: 'codex-failed' });
  });
});
