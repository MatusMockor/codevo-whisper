export type ModelVerification = 'ok' | 'missing' | 'broken';

export interface ActiveModel {
  activeModelPath(): Promise<string | null>;
  verifyActive(): Promise<ModelVerification>;
}
