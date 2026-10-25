#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const argsFile = process.env.FAKE_WORKER_ARGS_FILE;
const delayMs = Number(process.env.FAKE_WORKER_DELAY_MS ?? '0');
const crashSamples = Number(process.env.FAKE_WORKER_CRASH_SAMPLES ?? '-1');
const slowSamples = Number(process.env.FAKE_WORKER_SLOW_SAMPLES ?? '-1');
const replyText = process.env.FAKE_WORKER_REPLY_TEXT;

if (argsFile) {
  appendFileSync(argsFile, `${process.argv.slice(2).join(' ')}\n`);
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
  const languageLength = buffer[0];
  if (buffer.length < 1 + languageLength + 4) {
    return null;
  }
  const language = buffer.subarray(1, 1 + languageLength).toString('utf8');
  const samples = buffer.readUInt32LE(1 + languageLength);
  const total = 1 + languageLength + 4 + samples * 2;
  if (buffer.length < total) {
    return null;
  }
  buffer = buffer.subarray(total);
  return { language, samples };
}

async function handle(request) {
  await sleep(request.samples === slowSamples ? 5_000 : delayMs);
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
reply(2, '');
