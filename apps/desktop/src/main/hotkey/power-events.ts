export type PowerEvent = 'lock-screen' | 'suspend' | 'resume' | 'unlock-screen';

export interface PowerEvents {
  on(event: PowerEvent, listener: () => void): () => void;
}
