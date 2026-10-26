import type { ClientMessage } from '@codevo-whisper/protocol';
import type { Logger } from '../logging/logger';
import type { GatewayDispatcher } from '../stt/gateway-context';
import { logDictation } from './dictation-log';
import { Dictation, type DictationResult } from './dictation';
import type { DeviceAudioBudget } from './device-audio-budget';
import { FlowControl } from './flow-control';
import type { IngestionLimiter } from './ingestion-limiter';
import {
  CLOSE_INTERNAL_ERROR,
  MAX_AUDIO_SECONDS,
  MAX_SESSION_HARD_MS,
  MAX_SESSION_MS,
  MESSAGE_RATE,
  MIN_AUDIO_FRAME_BYTES,
} from './limits';
import { MessageRateLimiter } from './message-rate-limiter';
import { BYTES_PER_SECOND } from './pcm';
import type { SecureChannel } from './secure-channel';

export type SessionDeps = {
  dispatcher: GatewayDispatcher;
  clock: () => number;
  logger: Logger;
  budget: DeviceAudioBudget;
  ingestion: IngestionLimiter;
};

type StartMessage = Extract<ClientMessage, { type: 'start' }>;

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; dictation: Dictation; startedAt: number }
  | { kind: 'finishing'; dictation: Dictation; startedAt: number };

type Handlers = { [K in ClientMessage['type']]: (message: Extract<ClientMessage, { type: K }>) => void };

export class SessionHandler {
  private state: State = { kind: 'idle' };
  private shortFrameSeen = false;
  private reservedBytes = 0;
  private readonly rate: MessageRateLimiter;
  private readonly flow: FlowControl;
  private readonly connectedAt: number;
  private readonly timers: NodeJS.Timeout[];
  private readonly handlers: Handlers = {
    hello: () => this.channel.fail('bad_message'),
    start: (message) => this.onStart(message),
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
    this.rate = new MessageRateLimiter(deps.clock, MESSAGE_RATE);
    this.flow = new FlowControl(channel, () => deps.ingestion.availableSeconds(deviceId), deps.ingestion.limits);
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
    if (!this.rate.take()) {
      this.channel.fail('bad_message', 'message rate exceeded');
      return;
    }
    const handler = this.handlers[message.type] as (message: ClientMessage) => void;
    handler(message);
  }

  private onStart(message: StartMessage): void {
    if (this.state.kind !== 'idle') {
      this.channel.fail('bad_message');
      return;
    }
    const dictation = new Dictation({
      sessionId: message.sessionId,
      deviceId: this.deviceId,
      language: message.language,
      partials: message.partials === true,
      dispatcher: this.deps.dispatcher,
      clock: this.deps.clock,
      channel: this.channel,
    });
    this.state = { kind: 'recording', dictation, startedAt: this.deps.clock() };
    this.shortFrameSeen = false;
  }

  private onAudio(pcm: Uint8Array): void {
    if (this.state.kind !== 'recording') {
      this.channel.fail('bad_message');
      return;
    }
    if (this.shortFrameSeen) {
      this.channel.fail('bad_message', 'only the last audio frame may be shorter than 20 ms');
      return;
    }
    this.shortFrameSeen = pcm.length < MIN_AUDIO_FRAME_BYTES;
    const { dictation } = this.state;
    if ((dictation.audioBytes + pcm.length) / BYTES_PER_SECOND > MAX_AUDIO_SECONDS || !this.deps.budget.reserve(this.deviceId, pcm.length)) {
      this.channel.fail('too_long');
      return;
    }
    this.reservedBytes += pcm.length;
    if (!this.deps.ingestion.take(this.deviceId, pcm.length)) {
      this.channel.fail('bad_message', 'audio rate exceeded');
      return;
    }
    dictation.push(pcm);
    this.flow.update();
  }

  private onFinish(): void {
    if (this.state.kind !== 'recording') {
      this.channel.fail('bad_message');
      return;
    }
    const { dictation, startedAt } = this.state;
    const finishing: State = { kind: 'finishing', dictation, startedAt };
    this.state = finishing;
    const transcription = dictation.finish().then((result) => {
      this.log(dictation, startedAt, result);
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
    const { dictation } = this.state;
    dictation.cancel();
    this.channel.send({ type: 'done', sessionId: dictation.sessionId });
    this.becomeIdle();
  }

  private log(dictation: Dictation, startedAt: number, result: DictationResult): void {
    const { audioBytes, finals, partials } = dictation.stats();
    logDictation(this.deps.logger, {
      deviceId: this.deviceId,
      audioSeconds: audioBytes / BYTES_PER_SECOND,
      finals,
      partials,
      durationMs: this.deps.clock() - startedAt,
      result,
    });
  }

  private becomeIdle(): void {
    this.state = { kind: 'idle' };
    this.releaseBudget();
    this.expireIfIdle();
  }

  private releaseBudget(): void {
    this.deps.budget.release(this.deviceId, this.reservedBytes);
    this.reservedBytes = 0;
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
    this.flow.dispose();
    if (this.state.kind !== 'idle') {
      this.state.dictation.cancel();
    }
    this.state = { kind: 'idle' };
    this.releaseBudget();
  }
}
