import { expect, it } from 'vitest';
import { MobileSession } from '../src/core/session';
import type { ClientMessage, ServerMessage } from '@codevo-whisper/protocol';

function fixture(maxQueuedBytes = 320_000) {
  const sent: ClientMessage[] = [];
  let receive: (message: ServerMessage) => void = () => undefined;
  const session = new MobileSession(
    {
      send: (m) => sent.push(m),
      close: () => undefined,
      get bufferedAmount() {
        return 0;
      },
      listen: (fn) => {
        receive = fn;
      },
    },
    'run-1',
    'sk',
    { maxQueuedBytes, frameIntervalMs: 1 },
  );
  return { session, sent, receive: (m: ServerMessage) => receive(m) };
}

it('only finishes explicitly and assembles ordered final segments once', async () => {
  const { session, sent, receive } = fixture();
  session.push(new Uint8Array(3200));
  receive({ type: 'final', sessionId: 'run-1', segmentId: 1, text: 'svet' });
  receive({ type: 'final', sessionId: 'run-1', segmentId: 0, text: 'Ahoj' });
  const result = session.finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(sent.map((m) => m.type)).toEqual(['start', 'audio', 'finish']);
  receive({ type: 'done', sessionId: 'run-1' });
  expect(await result).toBe('Ahoj svet');
});

it('cancel rejects and delayed done never resolves to text', async () => {
  const { session, receive } = fixture();
  session.cancel();
  receive({ type: 'final', sessionId: 'run-1', segmentId: 0, text: 'late' });
  receive({ type: 'done', sessionId: 'run-1' });
  await expect(session.completion).rejects.toThrow('cancelled');
});

it('flow pauses preserve order and overflow fails rather than losing audio', async () => {
  const { session, sent, receive } = fixture(6400);
  receive({ type: 'flow', paused: true });
  session.push(new Uint8Array(3200).fill(1));
  session.push(new Uint8Array(3200).fill(2));
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(sent.map((m) => m.type)).toEqual(['start']);
  session.push(new Uint8Array(2));
  await expect(session.completion).rejects.toThrow('queue full');
});

it('flow resume sends all PCM then the short final tail before finish', async () => {
  const { session, sent, receive } = fixture();
  receive({ type: 'flow', paused: true });
  session.push(new Uint8Array(3200).fill(1));
  session.push(new Uint8Array(100).fill(2));
  const result = session.finish();
  receive({ type: 'flow', paused: false });
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(sent.map((m) => m.type)).toEqual(['start', 'audio', 'audio', 'finish']);
  expect(sent.filter((m) => m.type === 'audio').map((m) => m.pcm.length)).toEqual([3200, 100]);
  receive({ type: 'done', sessionId: 'run-1' });
  expect(await result).toBe('');
});

it('unsolicited done is a protocol error', async () => {
  const { session, receive } = fixture();
  receive({ type: 'done', sessionId: 'run-1' });
  await expect(session.completion).rejects.toThrow('before explicit finish');
});

it('a send failure rejects promptly and never finishes with partial text', async () => {
  const session = new MobileSession(
    {
      send: () => {
        throw new Error('offline');
      },
      close: () => undefined,
      bufferedAmount: 0,
      listen: () => undefined,
    },
    'failed',
    'en',
  );
  await expect(session.completion).rejects.toThrow('Connection lost');
});
