export type StartupSteps = {
  initialize(): Promise<void>;
  openWindow(): void;
  hasWindow(): boolean;
  fail(error: unknown): void;
};

export type Startup = { readonly started: Promise<void>; activate(): Promise<void>; reveal(): Promise<void> };

export function createStartup(ready: Promise<void>, steps: StartupSteps): Startup {
  const initialized = ready.then(() => steps.initialize());
  const openIfNone = (): void => {
    if (steps.hasWindow()) {
      return;
    }
    steps.openWindow();
  };
  const started = initialized.then(openIfNone, (error: unknown) => {
    steps.fail(error);
  });
  return {
    started,
    activate: () => initialized.then(openIfNone, () => undefined),
    reveal: () => initialized.then(() => steps.openWindow(), () => undefined),
  };
}
