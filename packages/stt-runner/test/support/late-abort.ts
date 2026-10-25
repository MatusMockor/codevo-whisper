type RemoveListener = AbortSignal['removeEventListener'];

export function abortWhenProcessSettles(): AbortController {
  const controller = new AbortController();
  const { signal } = controller;
  const remove: RemoveListener = signal.removeEventListener.bind(signal);
  signal.removeEventListener = (...args: Parameters<RemoveListener>): void => {
    remove(...args);
    controller.abort();
  };
  return controller;
}
