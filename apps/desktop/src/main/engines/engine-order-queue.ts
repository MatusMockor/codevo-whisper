import type { EngineId, Settings } from '../../shared/settings';
import type { SettingsStore } from '../settings/settings-store';

export type OrderDecision<T> = { order: EngineId[] | null; result: T };

export type OrderDecider<T> = (current: readonly EngineId[]) => OrderDecision<T> | Promise<OrderDecision<T>>;

export type SettingsDecision<T> = { patch: Partial<Settings> | null; result: T };

export type SettingsDecider<T> = (current: Settings) => SettingsDecision<T> | Promise<SettingsDecision<T>>;

export class EngineOrderQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly settings: Pick<SettingsStore, 'get' | 'update'>) {}

  change<T>(decide: OrderDecider<T>): Promise<T> {
    return this.update(async (current) => {
      const decision = await decide(current.engineOrder);
      return { patch: decision.order === null ? null : { engineOrder: decision.order }, result: decision.result };
    });
  }

  update<T>(decide: SettingsDecider<T>): Promise<T> {
    return this.exclusive(() => this.apply(decide));
  }

  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async apply<T>(decide: SettingsDecider<T>): Promise<T> {
    const decision = await decide(this.settings.get());
    if (decision.patch === null) {
      return decision.result;
    }
    await this.settings.update(decision.patch);
    return decision.result;
  }
}
