import type { TranscribeLanguage } from '../run-transcribe-cli';
import { TranscribeCliError } from '../transcribe-cli-error';

export type WorkerReplyStatus = 'ok' | 'failed' | 'ready';

export type WorkerReply = { status: WorkerReplyStatus; text: string };

const STATUSES: readonly WorkerReplyStatus[] = ['ok', 'failed', 'ready'];
const HEADER_BYTES = 5;
const LANGUAGE_TAGS: Readonly<Record<string, string>> = { sk: 'sk', en: 'en', cs: 'cs', auto: '' };
const MAX_SAMPLES = 30 * 16_000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

function languageTag(language: TranscribeLanguage): Buffer {
  const tag = Object.hasOwn(LANGUAGE_TAGS, language) ? LANGUAGE_TAGS[language] : undefined;
  if (tag === undefined) {
    throw new RangeError(`unsupported worker language ${JSON.stringify(language)}`);
  }
  return Buffer.from(tag, 'ascii');
}

function decodeText(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new TranscribeCliError('exit', 'transcribe worker sent invalid UTF-8');
  }
}

export function encodeWorkerRequest(language: TranscribeLanguage, pcm: Uint8Array, vocabulary: readonly string[] = []): Uint8Array {
  const tag = languageTag(language);
  const samples = Math.floor(pcm.length / 2);
  if (samples > MAX_SAMPLES) {
    throw new RangeError(`a worker request holds at most ${MAX_SAMPLES} samples`);
  }
  const header = Buffer.alloc(1 + tag.length + 4);
  header[0] = tag.length;
  tag.copy(header, 1);
  header.writeUInt32LE(samples, 1 + tag.length);
  const audio = pcm.subarray(0, samples * 2);
  if (vocabulary.length === 0) return Buffer.concat([header, audio]);
  if (vocabulary.length > 100) throw new RangeError('a worker request holds at most 100 vocabulary terms');
  const terms = vocabulary.map((term) => {
    const bytes = Buffer.from(term, 'utf8');
    if (term.length === 0 || [...term].length > 64 || bytes.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(term)) {
      throw new RangeError('invalid worker vocabulary term');
    }
    const length = Buffer.alloc(2);
    length.writeUInt16LE(bytes.length);
    return Buffer.concat([length, bytes]);
  });
  return Buffer.concat([Buffer.from([255]), header, Buffer.from([terms.length]), ...terms, audio]);
}

export class WorkerReplyReader {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxTextBytes: number) {}

  push(chunk: Buffer): WorkerReply[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const replies: WorkerReply[] = [];
    for (let reply = this.next(); reply !== null; reply = this.next()) {
      replies.push(reply);
    }
    return replies;
  }

  private next(): WorkerReply | null {
    if (this.buffer.length < HEADER_BYTES) {
      return null;
    }
    const status = STATUSES[this.buffer[0] ?? -1];
    const length = this.buffer.readUInt32LE(1);
    if (status === undefined) {
      throw new TranscribeCliError('exit', 'transcribe worker sent an unknown reply');
    }
    if (length > this.maxTextBytes) {
      throw new TranscribeCliError('output-too-large', `transcript has ${length} bytes, limit is ${this.maxTextBytes}`);
    }
    if (this.buffer.length < HEADER_BYTES + length) {
      return null;
    }
    const text = decodeText(this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length));
    this.buffer = this.buffer.subarray(HEADER_BYTES + length);
    return { status, text };
  }
}
