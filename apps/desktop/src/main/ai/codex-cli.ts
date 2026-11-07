import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { CodexCheck, CodexEffort } from '../../shared/ai';
import { isPlainRecord } from '../settings/settings-fields';
import { completionText, LlmError, MAX_RESPONSE_BYTES, type ChatMessage, type Complete } from './llm-client';

export type CodexTarget = { model: string; effort: CodexEffort; env?: NodeJS.ProcessEnv };

type RunOptions = { env: NodeJS.ProcessEnv; input: string; timeoutMs: number; signal?: AbortSignal | undefined };

const DISABLED_FEATURES = [
  'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'multi_agent', 'plugins', 'plugin_discovery_prefetch', 'shell_tool', 'unified_exec', 'skill_search', 'hooks',
  'shell_snapshot', 'view_image', 'goals', 'in_app_browser', 'realtime_conversation', 'tool_suggest', 'mentions_v2', 'skill_mcp_dependency_install', 'workspace_dependencies', 'worktrees', 'sleep_tool',
];
const STDERR_LIMIT = 4_000;
const LOGGED_OUT = /401 Unauthorized|not logged in/i;
const LOGIN_TIMEOUT_MS = 10_000;
const CHECK_TIMEOUT_MS = 30_000;
const CHECK_PROMPT = 'Reply with the single word OK.';

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function nvmBinDirs(home: string): Promise<string[]> {
  const versions = await readdir(join(home, '.nvm', 'versions', 'node')).catch(() => []);
  return versions.sort().reverse().map((version) => join(home, '.nvm', 'versions', 'node', version, 'bin'));
}

async function searchDirs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const home = env['HOME'] ?? '';
  const userDirs = home === '' ? [] : [join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), ...(await nvmBinDirs(home))];
  return [...(env['PATH'] ?? '').split(delimiter).filter((dir) => dir !== ''), ...userDirs, '/usr/local/bin', '/opt/homebrew/bin'];
}

export async function findCodex(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const dir of await searchDirs(env)) {
    const file = join(dir, 'codex');
    if (await isExecutable(file)) return file;
  }
  return null;
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function notFound(): LlmError {
  return new LlmError('codex-not-found', 'the codex binary was not found');
}

function aborted(): LlmError {
  return new LlmError('aborted', 'the request was cancelled');
}

function run(binary: string, args: readonly string[], { env, input, timeoutMs, signal }: RunOptions): Promise<{ code: number | null; stderr: string }> {
  if (signal?.aborted === true) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    // The npm wrapper needs `node` from its own directory, which a desktop launch often leaves off PATH.
    const child = spawn(binary, args, { env: { ...env, PATH: `${dirname(binary)}${delimiter}${env['PATH'] ?? ''}` }, stdio: ['pipe', 'ignore', 'pipe'], detached: true });
    let stderr = '';
    let stopped: LlmError | null = null;
    const stop = (error: LlmError): void => {
      stopped ??= error;
      killGroup(child.pid);
    };
    const onAbort = (): void => stop(aborted());
    const timer = setTimeout(() => stop(new LlmError('timeout', 'Codex CLI did not answer in time')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
    });
    // A CLI that exits before reading its prompt closes the pipe; the exit code reports that run.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
    child.once('error', (error: NodeJS.ErrnoException) => {
      settle();
      reject(stopped ?? (error.code === 'ENOENT' || error.code === 'EACCES' ? notFound() : new LlmError('codex-failed', `Codex CLI could not start: ${error.code ?? 'unknown'}`)));
    });
    child.once('close', (code) => {
      settle();
      if (stopped !== null) {
        reject(stopped);
        return;
      }
      resolve({ code, stderr });
    });
  });
}

function execArgs({ model, effort }: CodexTarget, workdir: string, output: string): string[] {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--ignore-user-config', '--ignore-rules', '--color', 'never',
    '-C', workdir, '-m', model, '-c', `model_reasoning_effort=${effort}`, '-o', output,
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '-',
  ];
}

async function readAnswer(file: string): Promise<string> {
  const size = await stat(file).then((info) => info.size, () => null);
  if (size === null) throw new LlmError('bad-response', 'Codex CLI wrote no answer');
  if (size > MAX_RESPONSE_BYTES) throw new LlmError('too-large', 'the answer is larger than 1 MB');
  return readFile(file, 'utf8');
}

function unwrapTranscript(text: string): string {
  if (!text.startsWith('{')) return text;
  try {
    const body: unknown = JSON.parse(text);
    return isPlainRecord(body) && Object.keys(body).length === 1 && typeof body['transcript'] === 'string' ? body['transcript'].trim() : text;
  } catch {
    return text;
  }
}

function prompt(messages: readonly ChatMessage[]): string {
  return messages.map((message) => message.content).join('\n\n');
}

export function codexProvider(target: CodexTarget): Complete {
  return async (messages, { timeoutMs, signal }) => {
    if (signal?.aborted === true) throw aborted();
    const env = target.env ?? process.env;
    const binary = await findCodex(env);
    if (binary === null) throw notFound();
    const workdir = await mkdtemp(join(tmpdir(), 'cw-codex-'));
    try {
      const output = join(workdir, 'answer.txt');
      const { code, stderr } = await run(binary, execArgs(target, workdir, output), { env, input: prompt(messages), timeoutMs, signal });
      if (code !== 0) throw new LlmError(LOGGED_OUT.test(stderr) ? 'codex-logged-out' : 'codex-failed', `Codex CLI exited with ${code ?? 'a signal'}`);
      return unwrapTranscript(completionText(await readAnswer(output)));
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  };
}

export async function checkCodex(target: CodexTarget, signal?: AbortSignal): Promise<CodexCheck> {
  const env = target.env ?? process.env;
  try {
    const binary = await findCodex(env);
    if (binary === null) throw notFound();
    const login = await run(binary, ['login', 'status'], { env, input: '', timeoutMs: LOGIN_TIMEOUT_MS, signal });
    if (login.code !== 0) return { ok: false, error: 'codex-logged-out' };
    await codexProvider({ ...target, env })([{ role: 'user', content: CHECK_PROMPT }], { timeoutMs: CHECK_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) });
    return { ok: true };
  } catch (error) {
    if (error instanceof LlmError) return { ok: false, error: error.reason };
    throw error;
  }
}
