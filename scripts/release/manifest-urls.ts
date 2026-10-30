import { readFile } from 'node:fs/promises';
import { FeedError } from './feed-error.ts';
import { parseUpdateManifest } from './update-manifest.ts';

async function main(manifestFile: string | undefined): Promise<number> {
  if (manifestFile === undefined) {
    console.error('usage: node scripts/release/manifest-urls.ts <update-manifest.yml>');
    return 2;
  }
  parseUpdateManifest(await readFile(manifestFile, 'utf8'), manifestFile).files.forEach((entry) => console.log(entry.url));
  return 0;
}

async function run(): Promise<number> {
  try {
    return await main(process.argv[2]);
  } catch (error) {
    if (error instanceof FeedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await run();
