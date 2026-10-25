import { createInterface } from 'node:readline';

let keycodes = [];

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
  'listen-start': (id, args) => {
    keycodes = args.keycodes;
    send({ id, running: true, keycodes });
  },
  'listen-state': (id) => send({ id, keycodes }),
  'record-key': (id) => send({ id, recording: true }),
  permissions: (id) => send({ id, listenEvent: true, postEvent: false, accessibility: true }),
  frontmost: (id) => send({ id, pid: 42, bundleId: 'com.apple.TextEdit', name: 'TextEdit', windowId: 7 }),
  'focused-element': (id) => send({ id, editable: null, role: 'AXWebArea', reason: 'chromium-no-tree' }),
  paste: (id) => send({ id, posted: false, reason: 'no-event-source' }),
};

createInterface({ input: process.stdin })
  .on('line', (line) => {
    const request = JSON.parse(line);
    const handler = handlers[request.cmd];
    if (!handler) {
      send({ id: request.id, error: 'unknown-command' });
      return;
    }
    handler(request.id, request.args ?? {});
  })
  .on('close', () => process.exit(0));

send({ event: 'ready', pid: process.pid });
