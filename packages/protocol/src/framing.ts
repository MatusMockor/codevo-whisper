import { badMessage } from './errors';
import { MAX_NOISE_MESSAGE } from './limits';

export enum HandshakeMode {
  Pair = 0x01,
  Session = 0x02,
}

export const PROLOGUE_PAIR = new TextEncoder().encode('cw1/pair');
export const PROLOGUE_SESSION = new TextEncoder().encode('cw1/session');

export type OpeningFrame = { mode: HandshakeMode; noiseMessage: Uint8Array };

function modeOf(byte: number | undefined): HandshakeMode {
  if (byte === HandshakeMode.Pair) {
    return HandshakeMode.Pair;
  }
  if (byte === HandshakeMode.Session) {
    return HandshakeMode.Session;
  }
  throw badMessage('unknown handshake mode');
}

export function encodeOpeningFrame(mode: HandshakeMode, noiseMessage: Uint8Array): Uint8Array {
  const frame = new Uint8Array(noiseMessage.length + 1);
  frame[0] = mode;
  frame.set(noiseMessage, 1);
  return frame;
}

export function decodeOpeningFrame(frame: Uint8Array): OpeningFrame {
  if (frame.length < 2) {
    throw badMessage('opening frame is too short');
  }
  if (frame.length - 1 > MAX_NOISE_MESSAGE) {
    throw badMessage('opening frame is too large');
  }
  return { mode: modeOf(frame[0]), noiseMessage: frame.subarray(1) };
}
