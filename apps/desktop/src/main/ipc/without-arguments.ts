import { rejectArguments } from './validate';

export function withoutArguments<T>(run: () => T | Promise<T>): (...args: unknown[]) => Promise<T> {
  return (...args) =>
    new Promise<T>((resolve) => {
      rejectArguments(args);
      resolve(run());
    });
}
