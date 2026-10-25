import { FeedError } from './feed-error.ts';
import { notaryPhase, readSubmission, recordSubmission, type SubmissionKind } from './notary-state.ts';

const USAGE = [
  'usage: node scripts/release/notary-state-cli.ts phase <state-dir>',
  '       node scripts/release/notary-state-cli.ts record <state-dir> <app|dmg> <submission-id> <file> [...]',
  '       node scripts/release/notary-state-cli.ts submission <state-dir> <app|dmg>',
].join('\n');

function kindOf(value: string | undefined): SubmissionKind | null {
  return value === 'app' || value === 'dmg' ? value : null;
}

async function main([command, stateDir, ...rest]: string[]): Promise<number> {
  const kind = kindOf(rest[0]);
  if (command === 'phase' && stateDir !== undefined) {
    console.log(await notaryPhase(stateDir));
    return 0;
  }
  if (command === 'record' && stateDir !== undefined && kind !== null && rest[1] !== undefined && rest.length > 2) {
    await recordSubmission(stateDir, kind, rest[1], rest.slice(2));
    return 0;
  }
  if (command === 'submission' && stateDir !== undefined && kind !== null) {
    console.log(await readSubmission(stateDir, kind));
    return 0;
  }
  console.error(USAGE);
  return 2;
}

async function run(): Promise<number> {
  try {
    return await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof FeedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await run();
