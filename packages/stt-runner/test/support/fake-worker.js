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
const backend = process.argv[process.argv.indexOf('--backend') + 1];
const model = process.argv[process.argv.indexOf('--model') + 1] ?? '';
const role = /lang-?id/i.test(model) ? 'langid' : 'asr';
const primaryFailure = backend !== 'cpu' && process.env.FAKE_WORKER_PRIMARY;
let readySent = false;

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

if (process.env.FAKE_WORKER_LOAD === 'fail' || primaryFailure === 'fail') {
  reply(1, 'model load failed');
  process.exit(1);
}

let buffer = Buffer.alloc(0);
let busy = Promise.resolve();

function nextLanguageIdRequest() {
  if (buffer.length < 2) return null;
  const count = buffer[1];
  let end = 2;
  const allowed = [];
  for (let index = 0; index < count; index++) {
    if (buffer.length < end + 1) return null;
    const length = buffer[end++];
    if (buffer.length < end + length) return null;
    allowed.push(buffer.subarray(end, end + length).toString('ascii'));
    end += length;
  }
  if (buffer.length < end + 4) return null;
  const samples = buffer.readUInt32LE(end);
  const total = end + 4 + samples * 2;
  if (buffer.length < total) return null;
  buffer = buffer.subarray(total);
  return { role: 'langid', allowed, samples };
}

function nextRequest() {
  if (buffer.length < 1) {
    return null;
  }
  if (buffer[0] === 254) return nextLanguageIdRequest();
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
  return { role: 'asr', language, samples, vocabulary };
}

function formatG(value) {
  const rounded = Number(value.toPrecision(9));
  if (rounded === 0 || Math.abs(rounded) >= 1e-4) return String(rounded);
  return rounded.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
}

function languageScores(allowed) {
  const top = process.env.FAKE_WORKER_LID_TOP;
  const ranked = allowed.includes(top) ? [top, ...allowed.filter((code) => code !== top)] : allowed;
  const first = ranked.length === 1 ? 1 : Number(process.env.FAKE_WORKER_LID_P ?? '0.9');
  const rest = ranked.length === 1 ? 0 : (1 - first) / (ranked.length - 1);
  return ranked.map((code, index) => `${code} ${formatG(index === 0 ? first : rest)}\n`).join('');
}

async function handle(request) {
  if (process.env.FAKE_WORKER_REQUIRE_READY === '1' && !readySent) process.exit(83);
  if (request.role !== role) return reply(1, 'wrong role');
  if (primaryFailure === 'crash') process.exit(3);
  if (primaryFailure === 'hang') await sleep(60_000);
  if (primaryFailure === 'error') return reply(1, 'inference failed');
  if (process.env.FAKE_WORKER_VOCABULARY === '1' && request.role === 'asr') return reply(0, JSON.stringify(request.vocabulary));
  await sleep(request.samples === slowSamples ? slowMs : delayMs);
  if (request.samples === crashSamples) {
    process.exit(3);
  }
  if (replyText !== undefined) {
    reply(0, replyText);
    return;
  }
  if (request.role === 'langid' && request.samples < Number(process.env.FAKE_WORKER_LID_MIN_SAMPLES ?? '0')) {
    reply(1, 'input audio too short');
    return;
  }
  if (request.role === 'langid') {
    reply(0, languageScores(request.allowed));
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
if (primaryFailure === 'exit') process.exit(127);
if (primaryFailure !== 'timeout') setTimeout(() => { readySent = true; reply(2, ''); }, loadDelayMs);
