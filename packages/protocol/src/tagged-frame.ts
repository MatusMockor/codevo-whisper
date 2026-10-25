import { badMessage } from './errors';
import { MessageTag } from './message-types';

export function tagged(tag: MessageTag, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(body.length + 1);
  frame[0] = tag;
  frame.set(body, 1);
  return frame;
}

export function jsonFrame(value: object): Uint8Array {
  return tagged(MessageTag.Json, new TextEncoder().encode(JSON.stringify(value)));
}

const TAGS = new Map<number, MessageTag>([
  [0x01, MessageTag.Json],
  [0x02, MessageTag.Audio],
]);

function tagOf(byte: number | undefined): MessageTag {
  if (byte === undefined) {
    throw badMessage('message is empty');
  }
  const tag = TAGS.get(byte);
  if (tag === undefined) {
    throw badMessage('unknown message tag');
  }
  return tag;
}

export function splitTag(frame: Uint8Array): { tag: MessageTag; body: Uint8Array } {
  return { tag: tagOf(frame[0]), body: frame.subarray(1) };
}
