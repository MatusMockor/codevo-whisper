export type JobKind = 'partial' | 'final';

export type TranscriptionJob = {
  deviceId: string;
  kind: JobKind;
  segmentId: number;
  revision: number;
  pcm: Uint8Array;
};

export type DropReason = 'partial-in-flight' | 'finalizing' | 'replaced' | 'superseded' | 'cancelled';

export type Dropped<T> = { entry: T; reason: DropReason };
