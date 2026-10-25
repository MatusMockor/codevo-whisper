export type HelperMessage = Readonly<Record<string, unknown>>;

export type HelperArgs = Readonly<Record<string, unknown>>;

export interface HelperChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
  request(cmd: string, args?: HelperArgs, timeoutMs?: number): Promise<HelperMessage>;
  onEvent(listener: (event: HelperMessage) => void): () => void;
  onRestart(listener: () => void): () => void;
}
