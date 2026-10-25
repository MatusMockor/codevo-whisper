import { readFile } from 'node:fs/promises';
import { beginSession, LANGUAGES, type Language } from '@codevo-whisper/protocol';
import type { IdentityStore } from './identity-store';
import { SecureSocket } from './secure-socket';
import { readPcmFromWav } from './wav-reader';

const FRAME_BYTES = 32_000;

function languageOf(value: string): Language {
  const language = LANGUAGES.find((candidate) => candidate === value);
  if (language === undefined) {
    throw new Error(`unsupported language ${value}; use ${LANGUAGES.join(', ')}`);
  }
  return language;
}

async function collect(socket: SecureSocket, print: (line: string) => void): Promise<number> {
  const segments: string[] = [];
  for (;;) {
    const message = await socket.next();
    if (message.type === 'final') {
      segments[message.segmentId] = message.text;
      continue;
    }
    if (message.type === 'done') {
      print(segments.join(' ').trim());
      return 0;
    }
    if (message.type === 'error') {
      print(`Chyba: ${message.code}`);
      return 1;
    }
  }
}

export async function transcribe(store: IdentityStore, file: string, languageText: string, print: (line: string) => void): Promise<number> {
  const identity = await store.load();
  if (identity === null) {
    print('Zariadenie nie je spárované, spustite najprv "pair".');
    return 1;
  }
  const pcm = readPcmFromWav(new Uint8Array(await readFile(file)));
  const language = languageOf(languageText);
  const socket = await SecureSocket.connect(identity.endpoint, beginSession(identity.deviceKey, identity.serverPublicKey));
  socket.send({ type: 'hello' });
  const ready = await socket.next();
  if (ready.type !== 'ready') {
    print(ready.type === 'error' ? `Chyba: ${ready.code}` : `Neočakávaná správa ${ready.type}`);
    socket.close();
    return 1;
  }
  socket.send({ type: 'start', sessionId: crypto.randomUUID(), language });
  for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
    socket.send({ type: 'audio', pcm: pcm.subarray(offset, offset + FRAME_BYTES) });
  }
  socket.send({ type: 'finish' });
  const exitCode = await collect(socket, print);
  socket.close();
  return exitCode;
}
