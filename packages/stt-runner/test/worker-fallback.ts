import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { ResidentTranscriber } from '../src/worker/resident-transcriber';

const { values } = parseArgs({ options: { accelerator: { type: 'string' }, cpu: { type: 'string' }, model: { type: 'string' }, pcm: { type: 'string' } } });
const { accelerator, cpu, model, pcm } = values;
if (!accelerator || !cpu || !model || !pcm) throw new Error('requires --accelerator --cpu --model --pcm');
const audio = await readFile(pcm);
for (const backend of ['cpu', 'auto'] as const) {
  const worker = new ResidentTranscriber({ binary: backend === 'cpu' ? cpu : accelerator, model, backend, threads: 4, startupTimeoutMs: 120_000, ...(backend === 'auto' ? { startupFallback: { binary: cpu, backend: 'cpu' as const } } : {}) });
  try {
    await worker.warmUp();
    const texts = [];
    for (let request = 0; request < 2; request += 1) texts.push(await worker.transcribe({ pcm: audio, language: 'en' }));
    if (texts.some((text) => text.length === 0)) throw new Error('empty native inference reply');
    console.log(JSON.stringify({ backend, ready: worker.ready(), replies: texts }));
  } finally { await worker.close(); }
}
