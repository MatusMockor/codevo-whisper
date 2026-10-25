import type { ClientMessage, Language } from '@codevo-whisper/protocol';
import type { Logger } from '../logging/logger';
import type { TranscriptionQueue } from '../stt/transcription-queue';
import { AudioBuffer } from './audio-buffer';
import { logDictation } from './dictation-log';
import { CLOSE_INTERNAL_ERROR, FLOW_PAUSE_SECONDS, MAX_AUDIO_SECONDS, MAX_SESSION_HARD_MS, MAX_SESSION_MS } from './limits';
import type { SecureChannel } from './secure-channel';
import { transcribeDictation } from './transcribe-dictation';

export type SessionDeps = { queue: TranscriptionQueue; clock: () => number; logger: Logger };

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; sessionId: string; language: Language; startedAt: number }
  | { kind: 'finishing'; sessionId: string; controller: AbortController };

type Handlers = { [K in ClientMessage['type']]: (message: Extract<ClientMessage, { type: K }>) => void };

export class SessionHandler {
  private state: State = { kind: 'idle' };
  private readonly audio = new AudioBuffer();
  private paused = false;
  private readonly connectedAt: number;
  private readonly timers: NodeJS.Timeout[];
  private readonly handlers: Handlers = {
    hello: () => this.channel.fail('bad_message'),
    start: (message) => this.onStart(message.sessionId, message.language),
    audio: (message) => this.onAudio(message.pcm),
    finish: () => this.onFinish(),
    cancel: () => this.onCancel(),
    'pair-request': () => this.channel.fail('bad_message'),
  };

  constructor(
    private readonly channel: SecureChannel,
    private readonly deviceId: string,
    private readonly deps: SessionDeps,
  ) {
    this.connectedAt = deps.clock();
    this.timers = [
      setTimeout(() => this.expireIfIdle(), MAX_SESSION_MS + 1),
      setTimeout(() => this.channel.fail('session_expired'), MAX_SESSION_HARD_MS + 1),
    ];
    this.timers.forEach((timer) => timer.unref());
    channel.onMessage((message) => this.handle(message));
    channel.onClose(() => this.dispose());
  }

  private handle(message: ClientMessage): void {
    if (this.expired()) {
      this.channel.fail('session_expired');
      return;
    }
    const handler = this.handlers[message.type] as (message: ClientMessage) => void;
    handler(message);
  }

  private onStart(sessionId: string, language: Language): void {
    if (this.state.kind !== 'idle') {
      this.channel.fail('bad_message');
      return;
    }
    this.state = { kind: 'recording', sessionId, language, startedAt: this.deps.clock() };
  }

  private onAudio(pcm: Uint8Array): void {
    if (this.state.kind !== 'recording') {
      this.channel.fail('bad_message');
      return;
    }
    this.audio.append(pcm);
    if (this.audio.seconds() > MAX_AUDIO_SECONDS) {
      this.channel.fail('too_long');
      return;
    }
    if (!this.paused && this.audio.seconds() > FLOW_PAUSE_SECONDS) {
      this.paused = true;
      this.channel.send({ type: 'flow', paused: true });
    }
  }

  private onFinish(): void {
    if (this.state.kind !== 'recording') {
      this.channel.fail('bad_message');
      return;
    }
    const { sessionId, language, startedAt } = this.state;
    const audioSeconds = this.audio.seconds();
    const controller = new AbortController();
    const finishing: State = { kind: 'finishing', sessionId, controller };
    this.state = finishing;
    const request = { deviceId: this.deviceId, sessionId, pcm: this.audio.take(), language, signal: controller.signal };
    const transcription = transcribeDictation(this.deps.queue, this.channel, request).then((outcome) => {
      logDictation(this.deps.logger, {
        deviceId: this.deviceId,
        audioSeconds,
        chunks: outcome.chunks,
        durationMs: this.deps.clock() - startedAt,
        result: outcome.result,
      });
      if (this.state === finishing) {
        this.becomeIdle();
      }
    });
    transcription.catch(() => this.channel.close(CLOSE_INTERNAL_ERROR));
  }

  private onCancel(): void {
    if (this.state.kind === 'idle') {
      return;
    }
    if (this.state.kind === 'finishing') {
      this.state.controller.abort();
    }
    this.channel.send({ type: 'done', sessionId: this.state.sessionId });
    this.becomeIdle();
  }

  private becomeIdle(): void {
    this.state = { kind: 'idle' };
    this.audio.clear();
    if (this.paused) {
      this.paused = false;
      this.channel.send({ type: 'flow', paused: false });
    }
    this.expireIfIdle();
  }

  private expired(): boolean {
    const elapsed = this.deps.clock() - this.connectedAt;
    return elapsed > MAX_SESSION_HARD_MS || (elapsed > MAX_SESSION_MS && this.state.kind === 'idle');
  }

  private expireIfIdle(): void {
    if (this.state.kind === 'idle' && this.deps.clock() - this.connectedAt > MAX_SESSION_MS) {
      this.channel.fail('session_expired');
    }
  }

  private dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    if (this.state.kind === 'finishing') {
      this.state.controller.abort();
    }
    this.state = { kind: 'idle' };
    this.audio.clear();
  }
}
