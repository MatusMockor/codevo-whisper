export function recoverUnlessAborted<T>(attempt: Promise<T>, signal: AbortSignal, rescue: (error: unknown) => Promise<T>): Promise<T> {
  return attempt.catch((error: unknown) => {
    if (signal.aborted) {
      throw error;
    }
    return rescue(error);
  });
}
