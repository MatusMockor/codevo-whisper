import type { TranscribeLanguage } from '../run-transcribe-cli';
import { TranscribeCliError } from '../transcribe-cli-error';

export type WorkerReplyStatus = 'ok' | 'failed' | 'ready';

export type WorkerReply = { status: WorkerReplyStatus; text: string };

const STATUSES: readonly WorkerReplyStatus[] = ['ok', 'failed', 'ready'];
const HEADER_BYTES = 5;

export function encodeWorkerRequest(language: TranscribeLanguage, pcm: Uint8Array): Uint8Array {
  const tag = Buffer.from(language === 'auto' ? '' : language, 'ascii');
  const samples = Math.floor(pcm.length / 2);
  const header = Buffer.alloc(1 + tag.length + 4);
  header[0] = tag.length;
  tag.copy(header, 1);
  header.writeUInt32LE(samples, 1 + tag.length);
  return Buffer.concat([header, pcm.subarray(0, samples * 2)]);
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
    const text = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8');
    this.buffer = this.buffer.subarray(HEADER_BYTES + length);
    return { status, text };
  }
}
