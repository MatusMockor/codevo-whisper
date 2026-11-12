import { loadSttConfig } from './config';
import { ServerModelManifest, type ModelFile } from './model-manifest';
import { provisionManifest } from './provision';

const GIGABYTE = 1_000_000_000;

const manifest = ServerModelManifest.pinned(loadSttConfig(process.env));
const lastPercent = new Map<string, number>();

const onProgress = (file: ModelFile, bytes: number, total: number | null): void => {
  if (total === null) {
    return;
  }
  const percent = Math.floor((bytes / total) * 100);
  if (percent % 5 !== 0 || percent === lastPercent.get(file.target)) {
    return;
  }
  lastPercent.set(file.target, percent);
  process.stdout.write(`${file.target}: ${percent} %\n`);
};

process.stdout.write(`Language models add ${(manifest.extraBytes() / GIGABYTE).toFixed(2)} GB\n`);
for (const { file, result } of await provisionManifest(manifest, onProgress)) {
  process.stdout.write(`${result === 'present' ? 'Model already present and verified' : 'Model downloaded and verified'}: ${file.target}\n`);
}
