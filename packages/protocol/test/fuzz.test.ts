import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { decodeOpeningFrame } from '../src/framing';
import { decodeClientMessage, decodeServerMessage, MessageTag } from '../src/messages';

const RUNS = 10_000;

function onlyProtocolErrors(decode: (bytes: Uint8Array) => unknown): (bytes: Uint8Array) => boolean {
  return (bytes) => {
    try {
      decode(bytes);
      return true;
    } catch (error) {
      return error instanceof ProtocolError && error.code === 'bad_message';
    }
  };
}

const randomBytes = fc.uint8Array({ maxLength: 512 });

const jsonFrames = fc.json().map((text) => {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = MessageTag.Json;
  frame.set(body, 1);
  return frame;
});

const decoders = [
  ['decodeOpeningFrame', decodeOpeningFrame],
  ['decodeClientMessage', decodeClientMessage],
  ['decodeServerMessage', decodeServerMessage],
] as const;

describe('parser fuzzing', () => {
  it.each(decoders)('%s throws only ProtocolError on random bytes', (_name, decode) => {
    fc.assert(fc.property(randomBytes, onlyProtocolErrors(decode)), { numRuns: RUNS });
  });

  it.each(decoders)('%s throws only ProtocolError on random JSON', (_name, decode) => {
    fc.assert(fc.property(jsonFrames, onlyProtocolErrors(decode)), { numRuns: RUNS });
  });
});
