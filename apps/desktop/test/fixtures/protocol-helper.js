import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

let keycodes = [];
const overrides = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const handlers = {
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
    keycodes = args.keycodes;
    send({ id, running: true, keycodes });
  },
  'listen-state': (id) => send({ id, keycodes }),
  'record-key': (id) => send({ id, recording: true }),
  permissions: (id) => send({ id, listenEvent: true, postEvent: false, accessibility: true }),
  frontmost: (id) => send({ id, pid: 42, bundleId: 'com.apple.TextEdit', name: 'TextEdit', windowId: 7 }),
  'focused-element': (id) => send({ id, editable: null, role: 'AXWebArea', reason: 'chromium-no-tree' }),
  'secure-input': (id) => send({ id, enabled: false }),
  'modifier-flags': (id) => send({ id, flags: 0x100, combinedFlags: 0x100 }),
  'clipboard-save': (id) => send({ id, items: 1, types: ['public.utf8-plain-text'] }),
  'clipboard-write': (id) => send({ id, written: true }),
  'clipboard-restore': (id, args) => send({ id, restored: args.force === true || typeof args.expectedText === 'string' }),
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
