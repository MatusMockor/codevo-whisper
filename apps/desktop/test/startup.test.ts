import { describe, expect, it } from 'vitest';
import { createStartup, type StartupSteps } from '../src/main/app/startup';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class RecordingSteps implements StartupSteps {
  readonly events: string[] = [];
  readonly failures: unknown[] = [];
  windows = 0;

  constructor(private readonly init: Deferred) {}

  initialize(): Promise<void> {
    this.events.push('initialize:start');
    return this.init.promise.then(() => {
      this.events.push('initialize:done');
    });
  }

  openWindow(): void {
    this.windows += 1;
    this.events.push('window');
  }

  hasWindow(): boolean {
    return this.windows > 0;
  }

  fail(error: unknown): void {
    this.failures.push(error);
  }
}

describe('createStartup', () => {
  it('opens exactly one window after initialisation when activate fires during init', async () => {
    const init = deferred();
    const steps = new RecordingSteps(init);
    const startup = createStartup(Promise.resolve(), steps);

    const activated = startup.activate();
    init.resolve();
    await Promise.all([startup.started, activated]);

    expect(steps.events).toEqual(['initialize:start', 'initialize:done', 'window']);
    expect(steps.windows).toBe(1);
  });

  it('opens a window on activate after all windows were closed', async () => {
    const init = deferred();
    const steps = new RecordingSteps(init);
    const startup = createStartup(Promise.resolve(), steps);
    init.resolve();
    await startup.started;
    steps.windows = 0;

    await startup.activate();

    expect(steps.windows).toBe(1);
  });

  it('reports a failed initialisation once and never opens a window', async () => {
    const init = deferred();
    const steps = new RecordingSteps(init);
    const failure = new Error('EACCES');
    const startup = createStartup(Promise.resolve(), steps);

    const activated = startup.activate();
    init.reject(failure);
    await Promise.all([startup.started, activated]);

    expect(steps.failures).toEqual([failure]);
    expect(steps.windows).toBe(0);
  });
});
