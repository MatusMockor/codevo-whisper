import type { Clock } from '../clock';
import type { PartialIntervalSource } from '../partials/partial-interval';
import type { DeviceRegistry, JobSubmitter } from '../scheduling/job-outcome';
import type { SegmentConfig } from '../segmentation/segment-config';
import type { TranscriptEvent } from '../transcript/transcript-event';
import type { VoiceActivityDetector } from '../vad/voice-activity-detector';

export type RollingSessionOptions = {
  deviceId: string;
  partials: boolean;
  submitter: JobSubmitter;
  registry: DeviceRegistry;
  interval: PartialIntervalSource;
  clock: Clock;
  onEvent: (event: TranscriptEvent) => void;
  vad?: VoiceActivityDetector;
  segment?: Partial<SegmentConfig>;
  minPartialTailMs?: number;
  msPerOverlapWord?: number;
};

export const DEFAULT_MIN_PARTIAL_TAIL_MS = 500;
export const DEFAULT_MS_PER_OVERLAP_WORD = 250;
