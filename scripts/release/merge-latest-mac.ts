import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FeedError } from './feed-error.ts';
import { mergeMacManifests } from './mac-manifest.ts';
import { parseUpdateManifest, serializeUpdateManifest } from './update-manifest.ts';

function main(outFile: string | undefined, inputs: string[]): number {
  if (outFile === undefined || inputs.length < 2) {
    console.error('usage: node scripts/release/merge-latest-mac.ts <out.yml> <latest-mac.yml> <latest-mac.yml> [...]');
    return 2;
  }
  const merged = mergeMacManifests(inputs.map((file) => parseUpdateManifest(readFileSync(file, 'utf8'), file)));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, serializeUpdateManifest(merged));
  console.log(`merged ${merged.files.length} files for ${merged.version} into ${outFile}`);
  return 0;
}

function run(): number {
  const [outFile, ...inputs] = process.argv.slice(2);
  try {
    return main(outFile, inputs);
  } catch (error) {
    if (error instanceof FeedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = run();
