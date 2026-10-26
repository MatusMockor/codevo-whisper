#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { locateJob, timelineWords } from './timeline-words.js';

const WAV_HEADER_BYTES = 44;

function samples(bytes) {
  const even = bytes.byteLength - (bytes.byteLength % 2);
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + even));
}

const args = process.argv.slice(2);
const output = args[args.indexOf('--output') + 1];
const wav = args.at(-1);
const env = process.env;

if (env.FAKE_CLI_ARGS_FILE) {
  appendFileSync(env.FAKE_CLI_ARGS_FILE, `${args.join('\n')}\n--\n`);
}

const source = samples(readFileSync(env.FAKE_TIMELINE_SOURCE));
const job = samples(readFileSync(wav).subarray(WAV_HEADER_BYTES));
const offset = locateJob(source, job);

if (env.FAKE_TIMELINE_JOBS) {
  appendFileSync(env.FAKE_TIMELINE_JOBS, `${offset} ${job.length}\n`);
}

if (env.FAKE_CLI_PID_FILE) {
  writeFileSync(env.FAKE_CLI_PID_FILE, String(process.pid));
}

const hangFrom = Number(env.FAKE_CLI_HANG_FROM_SAMPLE ?? Infinity);
if (offset >= hangFrom) {
  await sleep(30_000);
}

if (env.FAKE_CLI_DELAY_S) {
  await sleep(Number(env.FAKE_CLI_DELAY_S) * 1000);
}

if (offset < 0) {
  process.stderr.write('job audio does not map to one position in the timeline source\n');
  process.exit(4);
}

writeFileSync(output, ` ${timelineWords(source, offset, offset + job.length).join(' ')} \n`);
