import type { PowerEvent, PowerEvents } from '../src/main/hotkey/power-events';

export class FakePowerEvents implements PowerEvents {
  private readonly listeners = new Map<PowerEvent, Set<() => void>>();

  on(event: PowerEvent, listener: () => void): () => void {
    const listeners = this.listeners.get(event) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  emit(event: PowerEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener();
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}
