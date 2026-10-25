import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ProtocolError } from '../src/errors';
import { decodeOpeningFrame } from '../src/framing';
import { decodeClientMessage, decodeServerMessage, MessageTag } from '../src/messages';
import { parsePairingToken } from '../src/pairing';

const RUNS = 10_000;

function onlyProtocolErrors<T>(decode: (input: T) => unknown): (input: T) => boolean {
  return (input) => {
    try {
      decode(input);
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

  it('parsePairingToken throws only ProtocolError on random text', () => {
    const tokenLike = fc.tuple(fc.string(), fc.string(), fc.string()).map((parts) => `cw1:${parts.join(':')}`);
    fc.assert(fc.property(fc.oneof(fc.string(), tokenLike), onlyProtocolErrors(parsePairingToken)), { numRuns: RUNS });
  });
});
