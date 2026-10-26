import type { ClientMessage, ServerMessage } from '@codevo-whisper/protocol';
import { TranscriptionFailedError, type DictationOptions, type EngineDictation, type EngineFailureReason, type TranscriptUpdate } from '../engines/transcription-engine';
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
  reconnectDelaysMs: readonly number[];
  reconnectWindowMs: number;
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

const RECONNECTABLE: ReadonlySet<RemoteFailureKind> = new Set(['connection-lost', 'offline']);

function closeWhenReady(attempt: Promise<ReadyConnection>): void {
  attempt.then(
    (ready) => ready.connection.close(),
    () => undefined,
  );
}

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
  private backoff: { timer: NodeJS.Timeout; resolve: () => void } | null = null;

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
    connection.send(this.startMessage(attempt.sessionId));
    return attempt;
  }

  private startMessage(sessionId: string): ClientMessage {
    const start: ClientMessage = { type: 'start', sessionId, language: this.deps.options.language };
    if (this.deps.options.partials !== true) {
      return start;
    }
    return { ...start, partials: true } as ClientMessage;
  }

  private pump(): void {
    if (this.settled || this.reconnecting || this.paused) {
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
      this.showPartial(message.segmentId, message.revision, message.text);
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

  private showPartial(segmentId: number, revision: number, text: string): void {
    if (this.deps.options.partials !== true) {
      return;
    }
    if (segmentId > MAX_SEGMENT_ID) {
      this.fail(new RemoteFailure('protocol', 'the server sent a partial for a segment no dictation can have'));
      return;
    }
    this.notify({ type: 'partial', segmentId, revision, text });
  }

  private keepFinal(attempt: Attempt, segmentId: number, text: string): void {
    const textChars = attempt.textChars - (attempt.segments.get(segmentId)?.length ?? 0) + text.length;
    if (segmentId > MAX_SEGMENT_ID || textChars > MAX_TRANSCRIPT_CHARS) {
      this.fail(new RemoteFailure('protocol', 'the server sent more transcript than a dictation can have'));
      return;
    }
    attempt.segments.set(segmentId, text);
    attempt.textChars = textChars;
    this.notify({ type: 'final', segmentId, text });
  }

  private notify(update: TranscriptUpdate): void {
    this.deps.options.onTranscript?.(update);
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
      const ready = await this.connectAgain();
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

  private async connectAgain(): Promise<ReadyConnection> {
    const deadline = Date.now() + this.deps.reconnectWindowMs;
    for (const delayMs of [...this.deps.reconnectDelaysMs, null]) {
      try {
        return await this.attemptBefore(deadline);
      } catch (error) {
        if (this.settled || delayMs === null || !RECONNECTABLE.has(asRemoteFailure(error, 'connection-lost').kind)) {
          throw error;
        }
        await this.pause(Math.min(delayMs, deadline - Date.now()));
      }
    }
    throw new RemoteFailure('connection-lost', 'no reconnect attempt is left');
  }

  private attemptBefore(deadline: number): Promise<ReadyConnection> {
    const remainingMs = deadline - Date.now();
    if (this.settled || remainingMs <= 0) {
      return Promise.reject(new RemoteFailure('timeout', 'the server did not come back in time'));
    }
    const attempt = this.deps.reconnect(this.ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        closeWhenReady(attempt);
        reject(new RemoteFailure('timeout', 'the server did not come back in time'));
      }, remainingMs);
      attempt.then(
        (ready) => {
          clearTimeout(timer);
          resolve(ready);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.backoff = null;
        resolve();
      }, Math.max(0, ms));
      this.backoff = { timer, resolve };
    });
  }

  private stopBackoff(): void {
    if (this.backoff === null) {
      return;
    }
    clearTimeout(this.backoff.timer);
    this.backoff.resolve();
    this.backoff = null;
  }

  private resume(ready: ReadyConnection): void {
    if (!this.retry.canRetry()) {
      ready.connection.close();
      this.fail(new RemoteFailure('connection-lost', 'the recording outgrew the retry buffer during the reconnect'));
      return;
    }
    this.notify({ type: 'restart' });
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
    this.stopBackoff();
    this.attempt.connection.close();
  }
}
