export interface EngineComponent {
  ready(): boolean;
  warmUp(): Promise<void>;
  close(): Promise<void>;
}
