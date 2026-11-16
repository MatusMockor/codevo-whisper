export class ModelLoadingError extends Error {
  constructor() {
    super('the STT engine is still loading the requested model');
    this.name = 'ModelLoadingError';
  }
}
