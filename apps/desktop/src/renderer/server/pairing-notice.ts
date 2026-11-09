import type { ServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';

export type PairingNotice = { kind: 'switched'; deviceId: string; message: string; previous: EngineId[] } | { kind: 'available'; deviceId: string; message: string };

function sameOrder(left: readonly EngineId[], right: readonly EngineId[]): boolean {
  return left.length === right.length && left.every((engine, index) => engine === right[index]);
}

export function switchedMessage(host: string): string {
  return `Spárované. Prepis sa prepol na server ${host}. Lokálny model nemáte stiahnutý, takže bez tohto kroku by diktovanie nefungovalo.`;
}

export const AVAILABLE_MESSAGE = 'Server je pripravený. Prepis zatiaľ beží lokálne na tomto počítači.';

export function pairingNotice(view: ServerView, engineOrder: readonly EngineId[], dismissed: ReadonlySet<string>): PairingNotice | null {
  const { pairing, server } = view;
  if (pairing.kind !== 'paired' || server === null || server.deviceId !== pairing.deviceId || dismissed.has(pairing.deviceId)) {
    return null;
  }
  if (pairing.engine.kind === 'switched' && sameOrder(engineOrder, pairing.engine.current)) {
    return { kind: 'switched', deviceId: pairing.deviceId, message: switchedMessage(server.host), previous: pairing.engine.previous };
  }
  if (pairing.engine.kind === 'available' && engineOrder.length > 0 && engineOrder[0] !== 'server') {
    return { kind: 'available', deviceId: pairing.deviceId, message: AVAILABLE_MESSAGE };
  }
  return null;
}
