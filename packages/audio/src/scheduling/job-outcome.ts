import type { DropReason, TranscriptionJob } from './transcription-job';

export type JobOutcome = { status: 'done'; text: string } | { status: 'dropped'; reason: DropReason } | { status: 'failed'; error: unknown };

export interface JobSubmitter {
  submit(job: TranscriptionJob): Promise<JobOutcome>;
  cancelDevice(deviceId: string): void;
}

export interface DeviceRegistry {
  attach(deviceId: string, partials: boolean): void;
  detach(deviceId: string): void;
}
