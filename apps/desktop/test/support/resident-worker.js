#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { locateJob, timelineWords } from './timeline-words.js';

const env = process.env;
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
if (env.CW_WORKER_STARTS) appendFileSync(env.CW_WORKER_STARTS, `${JSON.stringify({ pid: process.pid, args })}\n`);
function reply(status, text) {
  const body = Buffer.from(text);
  const header = Buffer.alloc(5);
  header[0] = status;
  header.writeUInt32LE(body.length, 1);
  process.stdout.write(Buffer.concat([header, body]));
}
let buffer = Buffer.alloc(0);
let busy = Promise.resolve();
async function handle(language, pcm) {
  const mode = env.CW_WORKER_CONTROL ? readFileSync(env.CW_WORKER_CONTROL, 'utf8') : env.FAKE_CLI_MODE;
  if (env.FAKE_CLI_ARGS_FILE) appendFileSync(env.FAKE_CLI_ARGS_FILE, `${[...args, '--language', language || 'auto'].join('\n')}\n--\n`);
  if (env.FAKE_CLI_PID_FILE) writeFileSync(env.FAKE_CLI_PID_FILE, String(process.pid));
  if (mode === 'hang') await sleep(30_000);
  if (mode === 'fail') process.exit(3);
  if (env.FAKE_CLI_DELAY_S) await sleep(Number(env.FAKE_CLI_DELAY_S) * 1000);
  let text = `${process.pid}:${language || 'auto'}:${pcm.length / 2}`;
  if (mode === 'text') text = env.FAKE_CLI_TEXT ?? 'ahoj svet';
  if (mode === 'echo-chunk') text = pcm.readInt16LE(0) < 0 ? '' : `${pcm.readInt16LE(0)}:${pcm.length}`;
  let offset = 0;
  if (env.FAKE_TIMELINE_SOURCE) {
    const sourceBytes = readFileSync(env.FAKE_TIMELINE_SOURCE);
    const source = new Int16Array(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.length));
    const job = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length));
    offset = locateJob(source, job);
    if (offset < 0) return reply(1, 'job does not map to source');
    text = timelineWords(source, offset, offset + job.length).join(' ');
    if (env.FAKE_TIMELINE_JOBS) appendFileSync(env.FAKE_TIMELINE_JOBS, `${offset} ${job.length}\n`);
  }
  if (env.CW_WORKER_CALLS) appendFileSync(env.CW_WORKER_CALLS, `${JSON.stringify({ pid: process.pid, language, samples: pcm.length / 2, model })}\n`);
  if (offset >= Number(env.FAKE_CLI_HANG_FROM_SAMPLE ?? Infinity)) await sleep(30_000);
  await sleep(Number(env.CW_WORKER_DELAY_MS ?? 0));
  reply(env.CW_WORKER_FAIL === '1' ? 1 : 0, env.CW_WORKER_FAIL === '1' ? 'inference failed' : text);
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 1) {
    const n = buffer[0];
    if (buffer.length < 1 + n + 4) break;
    const size = buffer.readUInt32LE(1 + n) * 2;
    const end = 1 + n + 4 + size;
    if (buffer.length < end) break;
    const language = buffer.subarray(1, 1 + n).toString();
    const pcm = buffer.subarray(1 + n + 4, end);
    buffer = buffer.subarray(end);
    busy = busy.then(() => handle(language, pcm));
  }
});
process.stdin.on('end', () => void busy.then(() => process.exit(0)));
setTimeout(() => reply(env.CW_WORKER_LOAD_FAIL === '1' ? 1 : 2, env.CW_WORKER_LOAD_FAIL === '1' ? 'model load failed' : ''), Number(env.CW_WORKER_LOAD_MS ?? 0));
