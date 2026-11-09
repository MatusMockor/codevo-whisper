import type { EngineId } from '../../shared/settings';
import type { SettingsStore } from '../settings/settings-store';

export type OrderDecision<T> = { order: EngineId[] | null; result: T };

export type OrderDecider<T> = (current: readonly EngineId[]) => OrderDecision<T> | Promise<OrderDecision<T>>;

export class EngineOrderQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly settings: Pick<SettingsStore, 'get' | 'update'>) {}

  change<T>(decide: OrderDecider<T>): Promise<T> {
    return this.exclusive(() => this.apply(decide));
  }

  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async apply<T>(decide: OrderDecider<T>): Promise<T> {
    const decision = await decide(this.settings.get().engineOrder);
    if (decision.order === null) {
      return decision.result;
    }
    await this.settings.update({ engineOrder: decision.order });
    return decision.result;
  }
}
