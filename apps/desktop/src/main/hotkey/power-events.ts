export type PowerEvent = 'lock-screen' | 'suspend';

export interface PowerEvents {
  on(event: PowerEvent, listener: () => void): () => void;
}
