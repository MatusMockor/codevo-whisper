import { readFileSync } from 'node:fs';
import { FeedError } from './feed-error.ts';
import { expectedFusesFromBuilderConfig, fuseProblems, readFuseWire } from './fuse-verification.ts';

async function main(appPath: string | undefined, builderConfig: string | undefined): Promise<number> {
  if (appPath === undefined || builderConfig === undefined) {
    console.error('usage: node scripts/release/verify-fuses.ts <path/to/App.app> <electron-builder.yml>');
    return 2;
  }
  const expected = expectedFusesFromBuilderConfig(readFileSync(builderConfig, 'utf8'));
  const problems = fuseProblems(expected, await readFuseWire(appPath));
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem));
    return 1;
  }
  Object.entries(expected).forEach(([name, value]) => console.log(`ok ${name}=${value}`));
  return 0;
}

async function run(): Promise<number> {
  try {
    return await main(process.argv[2], process.argv[3]);
  } catch (error) {
    if (error instanceof FeedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await run();
