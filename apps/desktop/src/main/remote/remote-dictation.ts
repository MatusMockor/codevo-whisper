import type { ServerMessage } from '@codevo-whisper/protocol';
import { TranscriptionFailedError, type DictationOptions, type EngineDictation, type EngineFailureReason } from '../engines/transcription-engine';
import { AudioOutbox } from './audio-outbox';
import { asRemoteFailure, failureForCode, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import { RetryBuffer } from './retry-buffer';
import type { SecureConnection } from './secure-connection';
import type { ConnectionObserver, ReadyConnection } from './server-connector';

export type RemoteDictationDeps = {
  options: DictationOptions;
  observer: Pick<ConnectionObserver, 'failed'>;
  finishIdleMs: number;
  retryBufferBytes: number;
  reconnect: (previous: ReadyConnection) => Promise<ReadyConnection>;
  newSessionId?: () => string;
};

type Attempt = { connection: SecureConnection; sessionId: string; segments: Map<number, string>; textChars: number; finishSent: boolean };

export const MAX_SEGMENT_ID = 4095;
export const MAX_TRANSCRIPT_CHARS = 200_000;

const REASON_BY_KIND: Partial<Record<RemoteFailureKind, EngineFailureReason>> = {
  busy: 'busy',
  'stt-unavailable': 'stt-unavailable',
  'too-long': 'too-long',
  'device-unknown': 'repair-needed',
  'server-key-changed': 'repair-needed',
  'connection-lost': 'connection-lost',
  offline: 'connection-lost',
  timeout: 'connection-lost',
  'not-paired': 'connection-lost',
};

const RETRYABLE: ReadonlySet<RemoteFailureKind> = new Set(['connection-lost', 'offline', 'timeout']);

function joinSegments(segments: ReadonlyMap<number, string>): string {
  return [...segments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text.trim())
    .filter((text) => text !== '')
    .join(' ');
}

export class RemoteDictation implements EngineDictation {
  private readonly outbox = new AudioOutbox();
  private readonly retry: RetryBuffer;
  private readonly result = Promise.withResolvers<string>();
  private attempt: Attempt;
  private ready: ReadyConnection;
  private bestText = '';
  private retried = false;
  private reconnecting = false;
  private finishing = false;
  private paused = false;
  private settled = false;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    ready: ReadyConnection,
    private readonly deps: RemoteDictationDeps,
  ) {
    this.result.promise.catch(() => undefined);
    this.ready = ready;
    this.retry = new RetryBuffer(deps.retryBufferBytes);
    if (deps.options.signal.aborted) {
      this.attempt = this.idle(ready.connection);
      this.cancel();
      return;
    }
    this.attempt = this.begin(ready.connection);
    deps.options.signal.addEventListener('abort', () => this.cancel(), { once: true });
  }

  push(pcm: Uint8Array): void {
    if (this.settled) {
      return;
    }
    this.retry.append(pcm);
    this.outbox.append(pcm);
    this.pump();
  }

  finish(): Promise<string> {
    if (!this.finishing && !this.settled) {
      this.finishing = true;
      this.pump();
      this.armIdle();
    }
    return this.result.promise;
  }

  private idle(connection: SecureConnection): Attempt {
    return { connection, sessionId: '', segments: new Map(), textChars: 0, finishSent: false };
  }

  private begin(connection: SecureConnection): Attempt {
    const attempt: Attempt = { ...this.idle(connection), sessionId: this.deps.newSessionId?.() ?? crypto.randomUUID() };
    connection.onMessage((message) => this.receive(attempt, message));
    connection.onClose((failure) => this.dropped(attempt, failure));
    connection.send({ type: 'start', sessionId: attempt.sessionId, language: this.deps.options.language });
    return attempt;
  }

  private pump(): void {
    if (this.settled || this.reconnecting || (this.paused && !this.finishing)) {
      return;
    }
    const { connection } = this.attempt;
    for (const pcm of this.outbox.take(this.finishing)) {
      connection.send({ type: 'audio', pcm });
    }
    if (!this.finishing || this.attempt.finishSent) {
      return;
    }
    this.attempt.finishSent = true;
    connection.send({ type: 'finish' });
  }

  private receive(attempt: Attempt, message: ServerMessage): void {
    if (attempt !== this.attempt || this.settled) {
      return;
    }
    this.armIdle();
    if (message.type === 'flow') {
      this.paused = message.paused;
      this.pump();
      return;
    }
    if ('sessionId' in message && message.sessionId !== undefined && message.sessionId !== attempt.sessionId) {
      return;
    }
    this.handle(attempt, message);
  }

  private handle(attempt: Attempt, message: ServerMessage): void {
    if (message.type === 'partial') {
      return;
    }
    if (message.type === 'final') {
      this.keepFinal(attempt, message.segmentId, message.text);
      return;
    }
    if (message.type === 'done') {
      this.succeed(joinSegments(attempt.segments));
      return;
    }
    if (message.type === 'error') {
      this.dropped(attempt, new RemoteFailure(failureForCode(message.code), message.code));
      return;
    }
    this.fail(new RemoteFailure('protocol', `unexpected ${message.type} during a dictation`));
  }

  private keepFinal(attempt: Attempt, segmentId: number, text: string): void {
    const textChars = attempt.textChars - (attempt.segments.get(segmentId)?.length ?? 0) + text.length;
    if (segmentId > MAX_SEGMENT_ID || textChars > MAX_TRANSCRIPT_CHARS) {
      this.fail(new RemoteFailure('protocol', 'the server sent more transcript than a dictation can have'));
      return;
    }
    attempt.segments.set(segmentId, text);
    attempt.textChars = textChars;
  }

  private dropped(attempt: Attempt, failure: RemoteFailure): void {
    if (attempt !== this.attempt || this.settled || this.reconnecting) {
      return;
    }
    if (this.retried || !RETRYABLE.has(failure.kind) || !this.retry.canRetry()) {
      this.fail(failure);
      return;
    }
    this.retried = true;
    void this.reconnect(attempt);
  }

  private async reconnect(previous: Attempt): Promise<void> {
    this.reconnecting = true;
    this.clearIdle();
    previous.connection.close();
    this.bestText = joinSegments(previous.segments);
    try {
      const ready = await this.deps.reconnect(this.ready);
      this.reconnecting = false;
      if (this.settled) {
        ready.connection.close();
        return;
      }
      this.ready = ready;
      this.resume(ready);
    } catch (error) {
      this.reconnecting = false;
      if (this.settled) {
        return;
      }
      this.fail(asRemoteFailure(error, 'connection-lost'));
    }
  }

  private resume(ready: ReadyConnection): void {
    if (!this.retry.canRetry()) {
      ready.connection.close();
      this.fail(new RemoteFailure('connection-lost', 'the recording outgrew the retry buffer during the reconnect'));
      return;
    }
    this.attempt = this.begin(ready.connection);
    this.paused = false;
    this.outbox.reset(this.retry.audio());
    this.pump();
    this.armIdle();
  }

  private clearIdle(): void {
    if (this.idleTimer === null) {
      return;
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private textSoFar(): string {
    const current = joinSegments(this.attempt.segments);
    return current.length >= this.bestText.length ? current : this.bestText;
  }

  private armIdle(): void {
    if (!this.finishing || this.settled || this.reconnecting) {
      return;
    }
    this.clearIdle();
    const attempt = this.attempt;
    this.idleTimer = setTimeout(() => {
      if (attempt !== this.attempt) {
        return;
      }
      this.fail(new RemoteFailure('stt-unavailable', 'the connected server sent no result in time'));
    }, this.deps.finishIdleMs);
  }

  private succeed(text: string): void {
    this.settle();
    this.result.resolve(text);
  }

  private fail(failure: RemoteFailure): void {
    this.settle();
    this.deps.observer.failed(failure.kind);
    this.result.reject(new TranscriptionFailedError(REASON_BY_KIND[failure.kind] ?? 'protocol', this.textSoFar(), { cause: failure }));
  }

  private cancel(): void {
    if (this.settled) {
      return;
    }
    if (this.attempt.sessionId !== '') {
      this.attempt.connection.send({ type: 'cancel' });
    }
    this.settle();
    this.result.reject(new DOMException('The dictation was cancelled', 'AbortError'));
  }

  private settle(): void {
    this.settled = true;
    this.clearIdle();
    this.attempt.connection.close();
  }
}
