import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

let binding = {};
let recording = {};
let deferListen = false;
let deferredListen;
const overrides = new Map();
const operations = [];
const audioOperations = [];
let clipboard = '';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const handlers = {
  'output-audio': (id) => send({ id, kind: 'available', canMute: true, outputs: [{ id: 'speakers', label: 'Speakers' }] }),
  'recording-audio-begin': (id, args) => { audioOperations.push({ cmd: 'recording-audio-begin', ...args }); send({ id, begun: true }); },
  'recording-audio-end': (id, args) => { audioOperations.push({ cmd: 'recording-audio-end', ...args }); send({ id, ended: true }); },
  'audio-state': (id) => send({ id, operations: audioOperations }),
  ping: (id) => send({ id, pong: true, pid: process.pid }),
  echo: (id, args) => setTimeout(() => send({ id, value: args.value }), args.delayMs ?? 0),
  silent: () => undefined,
  crash: () => process.exit(1),
  emit: (id, args) => {
    send(args.event);
    send({ id });
  },
  'respond-next': (id, args) => {
    overrides.set(args.cmd, { response: args.response, delayMs: args.delayMs ?? 0 });
    send({ id });
  },
  'listen-start': (id, args) => {
    binding = args;
    const running = !process.argv.includes('--listen-rejected-with-edges');
    const packet = [{ id, running }];
    if (process.argv.includes('--listen-with-edges') || !running) {
      packet.push({ event: 'hotkey', listenId: args.listenId, phase: 'down', ts: 1000 });
      packet.push({ event: 'hotkey', listenId: args.listenId, phase: 'up', ts: 1300 });
    }
    const write = () => process.stdout.write(packet.map(message => JSON.stringify(message)).join('\n') + '\n');
    if (deferListen) {
      deferListen = false;
      deferredListen = write;
      return;
    }
    write();
  },
  'listen-defer-next': (id) => { deferListen = true; send({ id }); },
  'listen-finish': (id) => { deferredListen?.(); deferredListen = undefined; send({ id }); },
  'listen-state': (id) => send({ id, ...binding }),
  'record-key': (id, args) => {
    recording = args;
    send({ id, recording: true });
  },
  'record-state': (id) => send({ id, ...recording }),
  permissions: (id) => send({ id, listenEvent: true, postEvent: false, accessibility: true }),
  frontmost: (id) => send({ id, pid: 42, bundleId: 'com.apple.TextEdit', name: 'TextEdit', windowId: 7 }),
  'focused-element': (id) => send({ id, editable: null, role: 'AXWebArea', reason: 'chromium-no-tree' }),
  'secure-input': (id) => send({ id, enabled: false }),
  'modifier-flags': (id) => send({ id, flags: 0x100, combinedFlags: 0x100 }),
  'clipboard-save': (id) => send({ id, items: 1, types: ['public.utf8-plain-text'] }),
  'clipboard-write': (id, args) => { clipboard = args.text; send({ id, written: true }); },
  'clipboard-state': (id) => send({ id, text: clipboard }),
  'clipboard-restore': (id, args) => send({ id, restored: args.force === true || typeof args.expectedText === 'string' }),
  'type-text': (id, args) => { operations.push({ cmd: 'type-text', text: args.text }); send({ id, posted: true }); },
  submit: (id, args) => { operations.push({ cmd: 'submit', mode: args.mode }); send({ id, posted: true }); },
  'output-state': (id) => send({ id, operations }),
  paste: (id) => send({ id, posted: false, reason: 'no-event-source' }),
};

function respond(request) {
  const override = overrides.get(request.cmd);
  if (override) {
    overrides.delete(request.cmd);
    setTimeout(() => send({ ...override.response, id: request.id }), override.delayMs);
    return;
  }
  const handler = handlers[request.cmd];
  if (!handler) {
    send({ id: request.id, error: 'unknown-command' });
    return;
  }
  handler(request.id, request.args ?? {});
}

const firstRunMarker = process.argv.find((arg) => arg.startsWith('--exit-before-ready-once='))?.split('=')[1];
if (firstRunMarker && !existsSync(firstRunMarker)) {
  writeFileSync(firstRunMarker, '');
  process.exit(3);
}

const blockedMarker = process.argv.find((arg) => arg.startsWith('--exit-before-ready-if-exists='))?.split('=')[1];
if (blockedMarker && existsSync(blockedMarker)) {
  process.exit(4);
}

createInterface({ input: process.stdin })
  .on('line', (line) => respond(JSON.parse(line)))
  .on('close', () => process.exit(0));

send({ event: 'ready', pid: process.pid });
