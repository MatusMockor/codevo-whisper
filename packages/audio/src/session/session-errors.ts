export class SegmentFailedError extends Error {
  override readonly name = 'SegmentFailedError';

  constructor(
    readonly segmentId: number,
    readonly textSoFar: string,
    options: { cause: unknown },
  ) {
    super(`Transcription of segment ${segmentId} failed`, options);
  }
}

export class SessionCancelledError extends Error {
  override readonly name = 'SessionCancelledError';

  constructor() {
    super('Rolling session was cancelled');
  }
}
