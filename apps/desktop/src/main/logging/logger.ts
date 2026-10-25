export type Logger = {
  error(message: string, error: unknown): void;
};

export const consoleLogger: Logger = Object.freeze({
  error(message: string, error: unknown): void {
    console.error(message, error);
  },
});
