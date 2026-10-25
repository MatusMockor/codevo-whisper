export type JobKind = 'partial' | 'final';

export type TranscriptionContext = {
  language: string;
  model?: string;
};

export type TranscriptionJob<TContext = TranscriptionContext> = {
  sessionId: string;
  deviceId: string;
  kind: JobKind;
  segmentId: number;
  revision: number;
  pcm: Uint8Array;
  context: TContext;
};

export type QueueKey = Pick<TranscriptionJob<unknown>, 'sessionId' | 'deviceId' | 'kind'>;

export type DropReason = 'partial-in-flight' | 'finalizing' | 'replaced' | 'superseded' | 'cancelled';

export type Dropped<T> = { entry: T; reason: DropReason };
