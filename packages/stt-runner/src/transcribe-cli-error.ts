export type TranscribeCliFailure = 'spawn' | 'exit' | 'timeout' | 'missing-output' | 'output-too-large';

export class TranscribeCliError extends Error {
  override readonly name = 'TranscribeCliError';

  constructor(
    readonly reason: TranscribeCliFailure,
    message: string,
  ) {
    super(message);
  }
}
