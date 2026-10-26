import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [binary, model, pcmPath, backend = 'cpu'] = process.argv.slice(2);
if (binary === undefined || model === undefined || pcmPath === undefined) {
  process.stderr.write('usage: node worker-smoke.js <cw-stt-worker> <model.gguf> <audio.pcm> [backend]\n');
  process.exit(2);
}
const pcm = readFileSync(pcmPath);

function frame(language, samples, body = Buffer.alloc(samples * 2)) {
  const header = Buffer.alloc(1 + language.length + 4);
  header[0] = language.length;
  header.write(language, 1, 'latin1');
  header.writeUInt32LE(samples, 1 + language.length);
  return Buffer.concat([header, body]);
}

function run(args, input) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => resolve({ code, replies: parseReplies(Buffer.concat(chunks)) }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

function parseReplies(buffer) {
  const replies = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const length = buffer.readUInt32LE(offset + 1);
    replies.push({ status: buffer[offset], text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset + 5, offset + 5 + length)) });
    offset += 5 + length;
  }
  if (offset !== buffer.length) {
    replies.push({ status: 'garbage', text: `${buffer.length - offset} stray bytes` });
  }
  return replies;
}

const base = ['--model', model, '--backend', backend, '--threads', '4'];
const cases = [
  ['transcribes and exits 0 at end of input', base, frame('sk', pcm.length / 2, pcm), (r) => r.code === 0 && r.replies.length === 2 && r.replies[1].status === 0 && r.replies[1].text.length > 0],
  ['auto language', base, frame('', pcm.length / 2, pcm), (r) => r.code === 0 && r.replies[1]?.status === 0],
  ['rejects a language outside the whitelist', base, frame('de', 10), (r) => r.code === 3 && r.replies[1]?.status === 1],
  ['rejects an embedded NUL', base, frame('s\0', 10), (r) => r.code === 3 && r.replies[1]?.status === 1],
  ['rejects a 255 byte language', base, frame('a'.repeat(255), 10), (r) => r.code === 3 && r.replies[1]?.status === 1],
  ['rejects 480001 samples', base, frame('sk', 480_001, Buffer.alloc(0)), (r) => r.code === 3 && r.replies[1]?.status === 1],
  ['rejects UINT32_MAX samples', base, frame('sk', 0xffffffff, Buffer.alloc(0)), (r) => r.code === 3 && r.replies[1]?.status === 1],
  ['exits 3 on a truncated frame', base, frame('sk', 1000).subarray(0, 50), (r) => r.code === 3 && r.replies.length === 1],
  ['rejects --threads 0', ['--model', model, '--threads', '0'], Buffer.alloc(0), (r) => r.code === 2 && r.replies.length === 0],
  ['rejects --threads 4x', ['--model', model, '--threads', '4x'], Buffer.alloc(0), (r) => r.code === 2],
  ['rejects an unknown backend', ['--model', model, '--backend', 'cuda'], Buffer.alloc(0), (r) => r.code === 2],
  ['serves two concatenated frames', base, Buffer.concat([frame('sk', pcm.length / 2, pcm), frame('cs', 8000)]), (r) => r.code === 0 && r.replies.length === 3],
];

let failed = 0;
for (const [name, args, input, check] of cases) {
  const result = await run(args, input);
  const ok = check(result);
  failed += ok ? 0 : 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name} (exit ${result.code}, ${result.replies.map((reply) => reply.status).join(',')})\n`);
}
process.exit(failed === 0 ? 0 : 1);
