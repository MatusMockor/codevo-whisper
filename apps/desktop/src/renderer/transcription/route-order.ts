import type { EngineId } from '../../shared/settings';

export type RouteSlot = 0 | 1;

export function otherEngine(engine: EngineId): EngineId {
  return engine === 'server' ? 'local' : 'server';
}

export function swapped(order: readonly EngineId[]): EngineId[] {
  const [primary, fallback] = order;
  if (primary === undefined || fallback === undefined) {
    return [...order];
  }
  return [fallback, primary];
}

export function withFallback(order: readonly EngineId[]): EngineId[] {
  const primary = order[0] ?? 'local';
  return [primary, otherEngine(primary)];
}

export function withoutFallback(order: readonly EngineId[]): EngineId[] {
  return [order[0] ?? 'local'];
}

function sameOrder(left: readonly EngineId[], right: readonly EngineId[]): boolean {
  return left.length === right.length && left.every((engine, index) => engine === right[index]);
}

function placed(order: readonly EngineId[], engine: EngineId, slot: RouteSlot): EngineId[] {
  const other = otherEngine(engine);
  if (slot === 1) {
    return [other, engine];
  }
  return order.includes(other) ? [engine, other] : [engine];
}

export function droppedOrder(order: readonly EngineId[], engine: EngineId, slot: RouteSlot, serverAvailable: boolean): EngineId[] | null {
  const next = placed(order, engine, slot);
  if (sameOrder(next, order)) {
    return null;
  }
  if (next.includes('server') && !order.includes('server') && !serverAvailable) {
    return null;
  }
  return next;
}

export const ROUTE_TEXT: Readonly<Record<string, { title: string; detail: string }>> = Object.freeze({
  local: { title: 'Lokálne', detail: 'Prepisuje sa na tomto počítači stiahnutým modelom. Zvuk neopustí počítač.' },
  server: { title: 'Server', detail: 'Prepisuje váš spárovaný server. Zvuk putuje zašifrovaný od začiatku do konca.' },
  'server,local': { title: 'Server, potom lokálne', detail: 'Keď server pri začatí diktovania nie je dostupný, prepíše sa lokálne.' },
  'local,server': { title: 'Lokálne, potom server', detail: 'Keď lokálny model nie je pripravený, zvuk sa pošle zašifrovaný na váš server.' },
});

export function routeText(order: readonly EngineId[]): { title: string; detail: string } {
  return ROUTE_TEXT[order.join(',')] ?? { title: order.join(', '), detail: '' };
}
