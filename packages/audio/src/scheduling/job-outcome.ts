import type { DropReason, TranscriptionContext, TranscriptionJob } from './transcription-job';

export type JobOutcome = { status: 'done'; text: string } | { status: 'dropped'; reason: DropReason } | { status: 'failed'; error: unknown };

export interface JobSubmitter<TContext = TranscriptionContext> {
  submit(job: TranscriptionJob<TContext>): Promise<JobOutcome>;
  cancelSession(sessionId: string): void;
}

export interface DeviceRegistry {
  attach(deviceId: string, partials: boolean): string;
  detach(sessionId: string): void;
}
