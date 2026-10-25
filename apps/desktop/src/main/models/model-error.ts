export type ModelErrorReason = 'unknown-model' | 'not-ready' | 'busy' | 'http' | 'size' | 'incomplete' | 'checksum';

export class ModelError extends Error {
  override readonly name = 'ModelError';

  constructor(
    readonly reason: ModelErrorReason,
    message: string,
  ) {
    super(message);
  }
}
