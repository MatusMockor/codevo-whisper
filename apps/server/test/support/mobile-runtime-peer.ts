import {
  createHandshake,
  createPairingSecret,
  decodeClientMessage,
  decodeOpeningFrame,
  encodePairingToken,
  encodeServerMessage,
  generateKeyPair,
  HandshakeMode,
  PROLOGUE_PAIR,
  PROLOGUE_SESSION,
  SecureTransport,
  type ServerMessage,
} from '@codevo-whisper/protocol';
import { WebSocketServer } from 'ws';

export async function startMobileRuntimePeer() {
  const key = generateKeyPair();
  const secret = createPairingSecret();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 18788, maxPayload: 65536 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const stats = { resumedAudio: 0, pausedAudio: 0, errors: 0, sessions: 0, rejected: 0 };
  let paired = false;
  server.on('connection', (socket) => {
    let transport: SecureTransport | undefined;
    let pairing = false;
    let sessionId = '';
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (message: ServerMessage) => {
      if (transport !== undefined && socket.readyState === 1) socket.send(transport.seal(encodeServerMessage(message)));
    };
    socket.on('close', () => clearTimeout(timer));
    socket.on('message', (data) => {
      try {
        const frame = new Uint8Array(data instanceof ArrayBuffer ? data : Buffer.concat(Array.isArray(data) ? data : [data]));
        if (transport === undefined) {
          const opening = decodeOpeningFrame(frame);
          pairing = opening.mode === HandshakeMode.Pair;
          const state = createHandshake({
            pattern: pairing ? 'IKpsk2' : 'IK',
            initiator: false,
            staticKey: key,
            prologue: pairing ? PROLOGUE_PAIR : PROLOGUE_SESSION,
            ...(pairing ? { psk: secret } : {}),
          });
          state.readMessage(opening.noiseMessage);
          socket.send(state.writeMessage(new Uint8Array()));
          transport = new SecureTransport(state.result());
          return;
        }
        const message = decodeClientMessage(transport.open(frame));
        if (message.type === 'pair-request') {
          if (!paired) {
            stats.rejected++;
            paired = true;
            send({ type: 'pair-result', status: 'rejected' });
            return;
          }
          send({ type: 'pair-result', status: 'approved', deviceId: 'runtime-fixture' });
          return;
        }
        if (message.type === 'hello') {
          send({ type: 'ready', serverVersion: 'runtime-fixture' });
          return;
        }
        if (message.type === 'start') {
          stats.sessions++;
          sessionId = message.sessionId;
          paused = true;
          send({ type: 'flow', paused: true });
          timer = setTimeout(() => {
            paused = false;
            send({ type: 'flow', paused: false });
          }, 1000);
          return;
        }
        if (message.type === 'audio') {
          if (paused) stats.pausedAudio++;
          stats.resumedAudio += message.pcm.length;
          return;
        }
        if (message.type === 'finish') {
          if (stats.sessions > 1) {
            stats.errors++;
            send({ type: 'error', code: 'stt_unavailable', message: 'fixture failure', sessionId });
            return;
          }
          send({ type: 'final', sessionId, segmentId: 0, text: 'Flow respected' });
          send({ type: 'done', sessionId });
          return;
        }
        if (message.type === 'cancel') {
          send({ type: 'done', sessionId });
        }
      } catch {
        socket.close(4000);
      }
    });
  });
  return {
    stats,
    token: encodePairingToken({ serverPublicKey: key.publicKey, secret, endpoint: 'ws://10.0.2.2:18788' }),
    close: async () => {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
