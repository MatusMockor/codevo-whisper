import type { ClientMessage, Language, ServerMessage } from '@codevo-whisper/protocol';

export interface SessionChannel {
  send(message: ClientMessage): void;
  close(): void;
  readonly bufferedAmount: number;
  listen(receive: (message: ServerMessage) => void, failed: (error: Error) => void): void;
}

type SessionState = 'recording' | 'finishing' | 'finished' | 'cancelled' | 'failed';

export class MobileSession {
  private state: SessionState = 'recording';
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private paused = false;
  private finishSent = false;
  private readonly segments = new Map<number, string>();
  private textChars = 0;
  private readonly result: Promise<string>;
  private resolve: (text: string) => void = () => undefined;
  private reject: (error: Error) => void = () => undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly maxQueuedBytes: number;
  private readonly frameIntervalMs: number;

  constructor(
    private readonly channel: SessionChannel,
    private readonly sessionId: string,
    language: Language,
    options: { maxQueuedBytes?: number; frameIntervalMs?: number } = {},
  ) {
    this.maxQueuedBytes = options.maxQueuedBytes ?? 320_000;
    this.frameIntervalMs = options.frameIntervalMs ?? 100;
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.result.catch(() => undefined);
    channel.listen(
      (message) => this.receive(message),
      (error) => this.fail(error),
    );
    this.send({ type: 'start', sessionId, language });
    if (this.active()) {
      this.deadline = setTimeout(() => this.fail(new Error('Recording exceeded five minutes')), 300_000);
    }
  }

  get completion(): Promise<string> {
    return this.result;
  }

  push(pcm: Uint8Array): void {
    if (this.state !== 'recording') {
      return;
    }
    if (pcm.length === 0 || pcm.length % 2 !== 0) {
      this.fail(new Error('Invalid PCM frame'));
      return;
    }
    if (this.queuedBytes + pcm.length > this.maxQueuedBytes) {
      this.fail(new Error('Audio queue full. Recording stopped.'));
      return;
    }
    this.queue.push(pcm.slice());
    this.queuedBytes += pcm.length;
    this.schedule();
  }

  finish(): Promise<string> {
    if (this.state === 'recording') {
      this.state = 'finishing';
      clearTimeout(this.deadline);
      this.deadline = setTimeout(() => this.fail(new Error('Server did not finish in time')), 60_000);
      this.schedule();
    }
    return this.result;
  }

  cancel(): void {
    if (!this.active()) {
      return;
    }
    this.send({ type: 'cancel' });
    this.state = 'cancelled';
    this.dispose();
    this.reject(new Error('Recording cancelled'));
  }

  private active(): boolean {
    return this.state === 'recording' || this.state === 'finishing';
  }

  private send(message: ClientMessage): void {
    try {
      this.channel.send(message);
    } catch {
      this.fail(new Error('Connection lost'));
    }
  }

  private schedule(): void {
    if (!this.active() || this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, this.frameIntervalMs);
  }

  private take(size: number): Uint8Array {
    const frame = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const head = this.queue.shift();
      if (head === undefined) {
        throw new Error('Audio queue invariant');
      }
      const count = Math.min(head.length, size - offset);
      frame.set(head.subarray(0, count), offset);
      offset += count;
      if (count < head.length) {
        this.queue.unshift(head.subarray(count));
      }
    }
    this.queuedBytes -= size;
    return frame;
  }

  private pump(): void {
    if (!this.active()) {
      return;
    }
    if (this.paused || this.channel.bufferedAmount > 64_000) {
      this.schedule();
      return;
    }
    const minimum = this.state === 'finishing' ? 1 : 640;
    if (this.queuedBytes >= minimum) {
      this.send({ type: 'audio', pcm: this.take(Math.min(3200, this.queuedBytes)) });
    }
    if (this.state === 'finishing' && this.queuedBytes === 0 && !this.finishSent) {
      this.finishSent = true;
      this.send({ type: 'finish' });
    }
    if (this.queuedBytes > 0) {
      this.schedule();
    }
  }

  private receive(message: ServerMessage): void {
    if (!this.active()) {
      return;
    }
    if (message.type === 'error') {
      this.fail(new Error(`Server error: ${message.code}`));
      return;
    }
    if (message.type === 'flow') {
      this.paused = message.paused;
      this.schedule();
      return;
    }
    if (!('sessionId' in message) || message.sessionId !== this.sessionId) {
      this.fail(new Error('Unexpected session message'));
      return;
    }
    if (message.type === 'partial') {
      return;
    }
    if (message.type === 'final') {
      this.textChars += message.text.length - (this.segments.get(message.segmentId)?.length ?? 0);
      if (message.segmentId > 4095 || this.textChars > 200_000) {
        this.fail(new Error('Transcript limit exceeded'));
        return;
      }
      this.segments.set(message.segmentId, message.text);
      return;
    }
    if (message.type === 'done' && this.state === 'finishing' && this.finishSent) {
      this.state = 'finished';
      this.dispose();
      this.resolve(
        [...this.segments.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, text]) => text.trim())
          .filter(Boolean)
          .join(' '),
      );
      this.segments.clear();
      return;
    }
    this.fail(new Error('Server completed before explicit finish'));
  }

  private fail(error: Error): void {
    if (!this.active()) {
      return;
    }
    this.state = 'failed';
    this.dispose();
    this.segments.clear();
    this.reject(error);
  }

  private dispose(): void {
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.queue = [];
    this.queuedBytes = 0;
    this.channel.close();
  }
}
