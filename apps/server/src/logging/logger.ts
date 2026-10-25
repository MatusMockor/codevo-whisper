export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
}

export const silentLogger: Logger = {
  info: () => undefined,
};

export function streamLogger(write: (line: string) => void): Logger {
  return {
    info: (event, fields = {}) => write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`),
  };
}
