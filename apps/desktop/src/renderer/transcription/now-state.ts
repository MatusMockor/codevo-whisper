import { engineRemedy, orderProblem, routeOutcome, type EngineProblem, type EngineRemedy } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import { engineCard, type EngineCard, type EngineFacts } from './engine-cards';

export type NowTone = 'ok' | 'warn' | 'err';

export type NowState = { tone: NowTone; title: string; detail: string; remedy: EngineRemedy | null };

type Explanation = Pick<NowState, 'title' | 'detail'>;

function sentence(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase('sk-SK')}${text.slice(1)}`;
}

function fallbackDetail(fallback: EngineCard | null): string {
  if (fallback === null) {
    return 'Bez zálohy.';
  }
  if (fallback.ready) {
    return `Záloha: ${fallback.noun}, ${fallback.meta}.`;
  }
  return `Záloha (${fallback.noun}) teraz nie je pripravená: ${fallback.meta}.`;
}

function noModelDetail(facts: EngineFacts): string {
  if (facts.local.download !== null) {
    return 'Model sa sťahuje. Diktovanie začne fungovať, keď bude pripravený.';
  }
  if (facts.conditions.serverOff) {
    return 'Prepis je nastavený na lokálny model, ten nie je stiahnutý a server je odpojený.';
  }
  return 'Prepis je nastavený na lokálny model, ale ten nie je stiahnutý.';
}

function repairDetail(order: readonly EngineId[]): string {
  if (order.length > 1) {
    return 'Kým server znova nespárujete, Codevo Whisper naň neposiela zvuk a z bezpečnostných dôvodov neprejde ani na zálohu.';
  }
  return 'Kým server znova nespárujete, Codevo Whisper naň neposiela zvuk.';
}

function notPaired(order: readonly EngineId[], facts: EngineFacts): Explanation {
  if (facts.conditions.serverRepair) {
    return { title: 'Server treba znova spárovať', detail: repairDetail(order) };
  }
  return { title: 'Server nie je spárovaný', detail: 'Prepis je nastavený na server, ale žiadny nie je spárovaný.' };
}

const UNAVAILABLE_TITLES = Object.freeze({ busy: 'Server je zaneprázdnený', failed: 'Server odpovedá chybou' });

function offline(facts: EngineFacts): Explanation {
  const status = facts.server?.status;
  if (status?.kind === 'unavailable') {
    return { title: UNAVAILABLE_TITLES[status.reason], detail: 'Server teraz nemôže prepisovať a iný prepis nie je pripravený. Aplikácia to skúša znova sama.' };
  }
  const endpoint = facts.server?.endpoint ?? '';
  return { title: 'Server neodpovedá', detail: `Server na adrese ${endpoint} neodpovedá a iný prepis nie je pripravený.` };
}

const PROBLEMS: Readonly<Record<EngineProblem, (order: readonly EngineId[], facts: EngineFacts) => Explanation>> = Object.freeze({
  'no-model': (_order, facts) => ({ title: 'Lokálny model chýba', detail: noModelDetail(facts) }),
  'server-not-paired': notPaired,
  'server-offline': (_order, facts) => offline(facts),
});

function broken(order: readonly EngineId[], facts: EngineFacts): NowState {
  const problem = orderProblem(order, facts.conditions) ?? 'no-model';
  return { tone: 'err', ...PROBLEMS[problem](order, facts), remedy: engineRemedy(problem, facts.conditions) };
}

export function nowState(order: readonly EngineId[], facts: EngineFacts): NowState {
  const [primaryId = 'local', fallbackId] = order;
  const primary = engineCard(primaryId, facts);
  const fallback = fallbackId === undefined ? null : engineCard(fallbackId, facts);
  const engine = routeOutcome(order, facts.conditions).engine;
  if (engine === primaryId) {
    return { tone: 'ok', title: `Prepisuje sa na: ${primary.title}`, detail: fallbackDetail(fallback), remedy: null };
  }
  if (engine !== null && fallback !== null) {
    return { tone: 'warn', title: `Prepisuje sa na: ${fallback.title}`, detail: `${sentence(primary.noun)} teraz nie je pripravený (${primary.meta}), diktovanie preto ide na zálohu.`, remedy: null };
  }
  return broken(order, facts);
}
