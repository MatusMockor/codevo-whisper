import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { FeedError } from './feed-error.ts';
import { fileHash } from './file-hash.ts';

export type SubmissionKind = 'app' | 'dmg';
export type NotaryPhase = 'none' | 'app-submitted' | 'dmg-submitted';

type Submission = { submission: string; files: Record<string, string> };

const SUBMISSION_ID = /^[A-Za-z0-9-]+$/;

function recordFile(stateDir: string, kind: SubmissionKind): string {
  return join(stateDir, `${kind}.json`);
}

function insideState(stateDir: string, file: string): string {
  const path = resolve(stateDir, file);
  const fromState = relative(resolve(stateDir), path);
  if (isAbsolute(file) || fromState === '' || fromState.startsWith('..')) {
    throw new FeedError(`${file}: recorded files must be inside the state directory`);
  }
  return path;
}

async function readRecord(stateDir: string, kind: SubmissionKind): Promise<Submission | null> {
  const text = await readFile(recordFile(stateDir, kind), 'utf8').catch(() => null);
  if (text === null) {
    return null;
  }
  const record = JSON.parse(text) as Partial<Submission>;
  if (typeof record.submission !== 'string' || !SUBMISSION_ID.test(record.submission) || typeof record.files !== 'object' || record.files === null) {
    throw new FeedError(`${kind}.json: invalid notary state`);
  }
  return { submission: record.submission, files: record.files };
}

async function fileProblem(stateDir: string, file: string, sha256: string): Promise<string | null> {
  const actual = await fileHash(insideState(stateDir, file), 'sha256', 'hex').catch(() => null);
  if (actual === null) {
    return `${file}: missing`;
  }
  return actual === sha256 ? null : `${file}: sha256 differs`;
}

async function verifyRecord(stateDir: string, record: Submission): Promise<void> {
  const problems = (await Promise.all(Object.entries(record.files).map(([file, sha256]) => fileProblem(stateDir, file, sha256)))).filter(
    (problem): problem is string => problem !== null,
  );
  if (problems.length > 0) {
    throw new FeedError(`saved notary state does not match, refusing to resume: ${problems.join(', ')}`);
  }
}

export async function recordSubmission(stateDir: string, kind: SubmissionKind, submission: string, files: readonly string[]): Promise<void> {
  if (!SUBMISSION_ID.test(submission)) {
    throw new FeedError(`invalid submission id: ${submission}`);
  }
  const hashes = await Promise.all(files.map(async (file) => [file, await fileHash(insideState(stateDir, file), 'sha256', 'hex')] as const));
  const record: Submission = { submission, files: Object.fromEntries(hashes) };
  await writeFile(recordFile(stateDir, kind), `${JSON.stringify(record, null, 2)}\n`);
}

export async function readSubmission(stateDir: string, kind: SubmissionKind): Promise<string> {
  const record = await readRecord(stateDir, kind);
  if (record === null) {
    throw new FeedError(`no ${kind} submission recorded`);
  }
  return record.submission;
}

export async function notaryPhase(stateDir: string): Promise<NotaryPhase> {
  const app = await readRecord(stateDir, 'app');
  if (app === null) {
    return 'none';
  }
  await verifyRecord(stateDir, app);
  const dmg = await readRecord(stateDir, 'dmg');
  if (dmg === null) {
    return 'app-submitted';
  }
  await verifyRecord(stateDir, dmg);
  return 'dmg-submitted';
}
