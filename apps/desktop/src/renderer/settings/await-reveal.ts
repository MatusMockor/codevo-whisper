export type Subscribe = (listener: () => void) => () => void;

export type RevealWait = { attempt: () => boolean; changes: Subscribe; interruptions: Subscribe; giveUp: () => void; timeoutMs: number };

export function awaitReveal({ attempt, changes, interruptions, giveUp, timeoutMs }: RevealWait): () => void {
  if (attempt()) {
    return () => undefined;
  }
  let settled = false;
  const unsubscribers: Array<() => void> = [];
  const stop = (): void => {
    settled = true;
    clearTimeout(timer);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
  const timer = setTimeout(() => {
    stop();
    giveUp();
  }, timeoutMs);
  unsubscribers.push(
    changes(() => {
      if (settled || !attempt()) {
        return;
      }
      stop();
    }),
    interruptions(stop),
  );
  return stop;
}
