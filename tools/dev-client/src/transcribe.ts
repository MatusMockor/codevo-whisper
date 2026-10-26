import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { beginSession, LANGUAGES, type Language, type ServerMessage } from '@codevo-whisper/protocol';
import { pacedFrames, type PacingOptions } from './audio-pacer';
import type { IdentityStore } from './identity-store';
import { SecureSocket } from './secure-socket';
import { readPcmFromWav } from './wav-reader';

export type TranscribeOptions = { language: string; live: boolean };

const LIVE_PACING: PacingOptions = { frameMs: 100, burstSeconds: 0 };
const FILE_PACING: PacingOptions = { frameMs: 1000, burstSeconds: 120 };

function languageOf(value: string): Language {
  const language = LANGUAGES.find((candidate) => candidate === value);
  if (language === undefined) {
    throw new Error(`unsupported language ${value}; use ${LANGUAGES.join(', ')}`);
  }
  return language;
}

function printLive(message: ServerMessage, print: (line: string) => void): void {
  if (message.type === 'partial') {
    print(`~ [${message.segmentId} r${message.revision}] ${message.text}`);
    return;
  }
  if (message.type === 'final') {
    print(`= [${message.segmentId}] ${message.text}`);
  }
}

async function collect(socket: SecureSocket, sessionId: string, live: boolean, print: (line: string) => void): Promise<number> {
  const segments: string[] = [];
  for (;;) {
    const message = await socket.next();
    if ('sessionId' in message && message.sessionId !== sessionId) {
      continue;
    }
    if (live) {
      printLive(message, print);
    }
    if (message.type === 'final') {
      segments[message.segmentId] = message.text;
      continue;
    }
    if (message.type === 'done') {
      print(segments.filter((text) => text.length > 0).join(' ').trim());
      return 0;
    }
    if (message.type === 'error') {
      print(`Chyba: ${message.code}`);
      return 1;
    }
  }
}

async function stream(socket: SecureSocket, pcm: Uint8Array, pacing: PacingOptions, signal: AbortSignal): Promise<void> {
  const startedAt = performance.now();
  for (const frame of pacedFrames(pcm, pacing)) {
    const waitMs = startedAt + frame.atMs - performance.now();
    if (waitMs > 0) {
      await sleep(waitMs, undefined, { signal }).catch(() => undefined);
    }
    if (signal.aborted) {
      return;
    }
    socket.send({ type: 'audio', pcm: frame.pcm });
  }
  socket.send({ type: 'finish' });
}

export async function transcribe(store: IdentityStore, file: string, options: TranscribeOptions, print: (line: string) => void): Promise<number> {
  const identity = await store.load();
  if (identity === null) {
    print('Zariadenie nie je spárované, spustite najprv "pair".');
    return 1;
  }
  const pcm = readPcmFromWav(new Uint8Array(await readFile(file)));
  const language = languageOf(options.language);
  const socket = await SecureSocket.connect(identity.endpoint, beginSession(identity.deviceKey, identity.serverPublicKey));
  socket.send({ type: 'hello' });
  const ready = await socket.next();
  if (ready.type !== 'ready') {
    print(ready.type === 'error' ? `Chyba: ${ready.code}` : `Neočakávaná správa ${ready.type}`);
    socket.close();
    return 1;
  }
  const sessionId = crypto.randomUUID();
  socket.send({ type: 'start', sessionId, language, ...(options.live ? { partials: true } : {}) });
  const stopped = new AbortController();
  const result = collect(socket, sessionId, options.live, print).finally(() => stopped.abort());
  await stream(socket, pcm, options.live ? LIVE_PACING : FILE_PACING, stopped.signal);
  const exitCode = await result;
  socket.close();
  return exitCode;
}
