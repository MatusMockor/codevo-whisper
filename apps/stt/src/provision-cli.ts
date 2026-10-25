import { loadSttConfig } from './config';
import { MODEL_SHA256, MODEL_URL, provision } from './provision';

const { model } = loadSttConfig(process.env);
let lastPercent = -1;
const onProgress = (bytes: number, total: number | null): void => {
  if (total === null) {
    return;
  }
  const percent = Math.floor((bytes / total) * 100);
  if (percent % 5 !== 0 || percent === lastPercent) {
    return;
  }
  lastPercent = percent;
  process.stdout.write(`${percent} %\n`);
};

const result = await provision({ url: MODEL_URL, sha256: MODEL_SHA256, target: model, onProgress });
process.stdout.write(`${result === 'present' ? 'Model already present and verified' : 'Model downloaded and verified'}: ${model}\n`);
