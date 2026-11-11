import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { awaitReveal, type Subscribe } from '../src/renderer/settings/await-reveal';

class Signal {
  private readonly listeners = new Set<() => void>();

  readonly subscribe: Subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  emit(): void {
    [...this.listeners].forEach((listener) => listener());
  }

  get size(): number {
    return this.listeners.size;
  }
}

type Destination = { mounted: boolean; reveals: number; fallbacks: number };

function destination(mounted: boolean): Destination {
  return { mounted, reveals: 0, fallbacks: 0 };
}

function wait(target: Destination, changes: Signal, interruptions: Signal): () => void {
  return awaitReveal({
    attempt: () => {
      if (!target.mounted) {
        return false;
      }
      target.reveals += 1;
      return true;
    },
    changes: changes.subscribe,
    interruptions: interruptions.subscribe,
    giveUp: () => {
      target.fallbacks += 1;
    },
    timeoutMs: 3000,
  });
}

describe('awaiting a deep link destination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals a destination that is already there without watching', () => {
    const target = destination(true);
    const changes = new Signal();
    const interruptions = new Signal();

    wait(target, changes, interruptions);

    expect(target.reveals).toBe(1);
    expect(changes.size + interruptions.size).toBe(0);
  });

  it('reveals the destination exactly once after it mounts and stops watching', () => {
    const target = destination(false);
    const changes = new Signal();
    const interruptions = new Signal();
    wait(target, changes, interruptions);

    changes.emit();
    expect(target.reveals).toBe(0);
    target.mounted = true;
    changes.emit();
    changes.emit();
    vi.advanceTimersByTime(5000);

    expect(target).toEqual({ mounted: true, reveals: 1, fallbacks: 0 });
    expect(changes.size + interruptions.size).toBe(0);
  });

  it('falls back once when the destination never mounts', () => {
    const target = destination(false);
    const changes = new Signal();
    const interruptions = new Signal();
    wait(target, changes, interruptions);

    vi.advanceTimersByTime(2999);
    expect(target.fallbacks).toBe(0);
    vi.advanceTimersByTime(1);
    target.mounted = true;
    changes.emit();

    expect(target).toEqual({ mounted: true, reveals: 0, fallbacks: 1 });
    expect(changes.size + interruptions.size).toBe(0);
  });

  it('gives up silently when the user acts first or the page goes away', () => {
    const interrupted = destination(false);
    const interruptions = new Signal();
    wait(interrupted, new Signal(), interruptions);
    interruptions.emit();

    const left = destination(false);
    const changes = new Signal();
    const stop = wait(left, changes, new Signal());
    stop();

    interrupted.mounted = true;
    left.mounted = true;
    changes.emit();
    vi.advanceTimersByTime(5000);

    expect(interrupted).toEqual({ mounted: true, reveals: 0, fallbacks: 0 });
    expect(left).toEqual({ mounted: true, reveals: 0, fallbacks: 0 });
  });
});
