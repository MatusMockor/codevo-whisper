import { engineRemedy, orderProblem, type EngineConditions, type EngineProblem, type EngineRemedy } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';

export type EngineNotice = { message: string; remedy: EngineRemedy };

export const ENGINE_NOTICE_MESSAGES = Object.freeze({
  serverReady: 'Lokálny model nemáte stiahnutý, takže s touto voľbou diktovanie nebude fungovať.',
  serverOffline: 'Lokálny model nemáte stiahnutý a spárovaný server teraz nie je dostupný, takže diktovanie zatiaľ nebude fungovať.',
  noServer: 'Lokálny model nemáte stiahnutý a server nie je spárovaný, takže diktovanie zatiaľ nebude fungovať.',
  serverNotPaired: 'Server teraz nie je pripravený, takže s touto voľbou diktovanie nebude fungovať.',
  serverUnreachable: 'Server teraz nie je dostupný, takže s touto voľbou diktovanie nebude fungovať.',
});

function missingModelMessage(conditions: EngineConditions): string {
  if (!conditions.serverReady) {
    return ENGINE_NOTICE_MESSAGES.noServer;
  }
  if (conditions.serverOffline) {
    return ENGINE_NOTICE_MESSAGES.serverOffline;
  }
  return ENGINE_NOTICE_MESSAGES.serverReady;
}

const PROBLEM_MESSAGES: Readonly<Record<EngineProblem, (conditions: EngineConditions) => string>> = Object.freeze({
  'no-model': missingModelMessage,
  'server-not-paired': () => ENGINE_NOTICE_MESSAGES.serverNotPaired,
  'server-offline': () => ENGINE_NOTICE_MESSAGES.serverUnreachable,
});

export function engineNotice(engineOrder: readonly EngineId[], conditions: EngineConditions | null): EngineNotice | null {
  if (conditions === null) {
    return null;
  }
  const problem = orderProblem(engineOrder, conditions);
  if (problem === null) {
    return null;
  }
  const remedy = engineRemedy(problem, conditions);
  if (remedy === null) {
    return null;
  }
  return { message: PROBLEM_MESSAGES[problem](conditions), remedy };
}
