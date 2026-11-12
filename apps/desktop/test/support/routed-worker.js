#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const model = basename(args[args.indexOf('--model') + 1] ?? '', '.gguf');
const backend = args[args.indexOf('--backend') + 1];
const replies = JSON.parse(process.env.CW_MODEL_REPLIES ?? '{}');
if (process.env.CW_ROUTED_STARTS) appendFileSync(process.env.CW_ROUTED_STARTS, `${JSON.stringify({ pid: process.pid, model, backend })}\n`);
if (replies[model] !== undefined) process.env.FAKE_WORKER_REPLY_TEXT = replies[model];
await import('../../../../packages/stt-runner/test/support/fake-worker.js');
