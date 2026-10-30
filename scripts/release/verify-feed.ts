import { FeedError } from './feed-error.ts';
import { verifyFeed } from './feed-verification.ts';

async function main(manifestFile: string | undefined, expectedVersion: string | undefined): Promise<number> {
  if (manifestFile === undefined) {
    console.error('usage: node scripts/release/verify-feed.ts <feed/latest-mac.yml|latest-linux.yml|latest-linux-arm64.yml> [expected-version]');
    return 2;
  }
  const report = await verifyFeed(manifestFile, expectedVersion);
  if (report.problems.length > 0) {
    report.problems.forEach((problem) => console.error(problem));
    return 1;
  }
  report.manifest.files.forEach((entry) => console.log(`ok ${entry.url} size=${entry.size}`));
  console.log(`feed ${report.manifest.version} valid: ${report.manifest.files.length} files, archs ${report.archs.join(', ')}`);
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
