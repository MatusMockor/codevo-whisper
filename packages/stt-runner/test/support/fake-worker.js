#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const argsFile = process.env.FAKE_WORKER_ARGS_FILE;
const delayMs = Number(process.env.FAKE_WORKER_DELAY_MS ?? '0');
const crashSamples = Number(process.env.FAKE_WORKER_CRASH_SAMPLES ?? '-1');
const slowSamples = Number(process.env.FAKE_WORKER_SLOW_SAMPLES ?? '-1');
const slowMs = Number(process.env.FAKE_WORKER_SLOW_MS ?? '5000');
const loadDelayMs = Number(process.env.FAKE_WORKER_LOAD_DELAY_MS ?? '0');
const replyText = process.env.FAKE_WORKER_REPLY_TEXT;

if (argsFile) {
  appendFileSync(argsFile, `${process.argv.slice(2).join(' ')}\n`);
}
if (process.env.FAKE_WORKER_SPAWNS_FILE) {
  appendFileSync(process.env.FAKE_WORKER_SPAWNS_FILE, `${Date.now()}\n`);
}

function reply(status, text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(5);
  header[0] = status;
  header.writeUInt32LE(body.length, 1);
  process.stdout.write(Buffer.concat([header, body]));
}

if (process.env.FAKE_WORKER_LOAD === 'fail') {
  reply(1, 'model load failed');
  process.exit(1);
}

let buffer = Buffer.alloc(0);
let busy = Promise.resolve();

function nextRequest() {
  if (buffer.length < 1) {
    return null;
  }
  const extended = buffer[0] === 255;
  const base = extended ? 1 : 0;
  if (buffer.length < base + 1) return null;
  const languageLength = buffer[base];
  if (buffer.length < base + 1 + languageLength + 4) {
    return null;
  }
  const language = buffer.subarray(base + 1, base + 1 + languageLength).toString('utf8');
  const samples = buffer.readUInt32LE(base + 1 + languageLength);
  let end = base + 1 + languageLength + 4;
  const vocabulary = [];
  if (extended) {
    if (buffer.length < end + 1) return null;
    const count = buffer[end++];
    for (let index = 0; index < count; index++) {
      if (buffer.length < end + 2) return null;
      const length = buffer.readUInt16LE(end);
      end += 2;
      if (buffer.length < end + length) return null;
      vocabulary.push(buffer.subarray(end, end + length).toString('utf8'));
      end += length;
    }
  }
  const total = end + samples * 2;
  if (buffer.length < total) {
    return null;
  }
  buffer = buffer.subarray(total);
  return { language, samples, vocabulary };
}

async function handle(request) {
  if (process.env.FAKE_WORKER_VOCABULARY === '1') return reply(0, JSON.stringify(request.vocabulary));
  await sleep(request.samples === slowSamples ? slowMs : delayMs);
  if (request.samples === crashSamples) {
    process.exit(3);
  }
  if (replyText !== undefined) {
    reply(0, replyText);
    return;
  }
  reply(0, `${process.pid}:${request.language || 'auto'}:${request.samples}`);
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (let request = nextRequest(); request !== null; request = nextRequest()) {
    const current = request;
    busy = busy.then(() => handle(current));
  }
});
process.stdin.on('end', () => {
  void busy.then(() => process.exit(0));
});
setTimeout(() => reply(2, ''), loadDelayMs);
