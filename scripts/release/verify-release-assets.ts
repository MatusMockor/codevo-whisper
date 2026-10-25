import { compareAssetDirs } from './asset-comparison.ts';

async function main(expectedDir: string | undefined, actualDir: string | undefined): Promise<number> {
  if (expectedDir === undefined || actualDir === undefined) {
    console.error('usage: node scripts/release/verify-release-assets.ts <local-feed-dir> <downloaded-release-dir>');
    return 2;
  }
  const problems = await compareAssetDirs(expectedDir, actualDir);
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem));
    return 1;
  }
  console.log(`release assets match ${expectedDir}`);
  return 0;
}

process.exitCode = await main(process.argv[2], process.argv[3]);
