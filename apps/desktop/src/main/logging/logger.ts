export type Logger = {
  info(message: string, detail: unknown): void;
  error(message: string, error: unknown): void;
};

export const consoleLogger: Logger = Object.freeze({
  info(message: string, detail: unknown): void {
    console.info(message, detail);
  },
  error(message: string, error: unknown): void {
    console.error(message, error);
  },
});
