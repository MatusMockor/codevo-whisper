export function nullUnlessAborted<T>(attempt: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return attempt.catch((error: unknown) => {
    if (signal.aborted) {
      throw error;
    }
    return null;
  });
}
