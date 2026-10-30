import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileHash } from './file-hash.ts';

export type ChecksumEntry = { hash: string; name: string };

export type ChecksumReport = { entries: ChecksumEntry[]; problems: string[] };

const CHECKSUM_LINE = /^([0-9a-f]{64}) [ *](.+)$/;

function parseLine(line: string): ChecksumEntry | string {
  const [, hash, name] = CHECKSUM_LINE.exec(line) ?? [];
  if (hash === undefined || name === undefined) {
    return `not a sha256sum line: ${JSON.stringify(line)}`;
  }
  if (basename(name) !== name || name === '..' || name === '.') {
    return `${name}: not a plain file name`;
  }
  return { hash, name };
}

async function isFile(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  );
}

async function entryProblem(dir: string, entry: ChecksumEntry): Promise<string | null> {
  const file = join(dir, entry.name);
  if (!(await isFile(file))) {
    return `${entry.name}: missing`;
  }
  return (await fileHash(file, 'sha256', 'hex')) === entry.hash ? null : `${entry.name}: sha256 mismatch`;
}

export async function verifyChecksums(checksumFile: string): Promise<ChecksumReport> {
  const lines = (await readFile(checksumFile, 'utf8')).split('\n').filter((line) => line !== '');
  const parsed = lines.map(parseLine);
  const entries = parsed.filter((line): line is ChecksumEntry => typeof line !== 'string');
  const lineProblems = parsed.filter((line): line is string => typeof line === 'string');
  const fileProblems = await Promise.all(entries.map((entry) => entryProblem(dirname(checksumFile), entry)));
  const emptyProblem = lines.length === 0 ? ['no checksums'] : [];
  return { entries, problems: [...emptyProblem, ...lineProblems, ...fileProblems.filter((problem): problem is string => problem !== null)] };
}
