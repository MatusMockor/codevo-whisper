import fuses from '@electron/fuses';
import { load } from 'js-yaml';
import { FeedError } from './feed-error.ts';

export const DISABLED = 48;
export const ENABLED = 49;

export type ExpectedFuses = Record<string, boolean>;
export type FuseWire = Partial<Record<number, number>>;

function optionIndex(name: string): number | undefined {
  const key = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const index: unknown = (fuses.FuseV1Options as unknown as Record<string, unknown>)[key];
  return typeof index === 'number' ? index : undefined;
}

function stateLabel(state: number | undefined): string {
  if (state === ENABLED) {
    return 'enabled';
  }
  if (state === DISABLED) {
    return 'disabled';
  }
  return state === undefined ? 'missing' : `state ${state}`;
}

export function expectedFusesFromBuilderConfig(text: string): ExpectedFuses {
  const config: unknown = load(text);
  const declared: unknown = typeof config === 'object' && config !== null ? (config as Record<string, unknown>)['electronFuses'] : undefined;
  if (typeof declared !== 'object' || declared === null) {
    throw new FeedError('electron-builder config has no electronFuses');
  }
  const entries = Object.entries(declared);
  const invalid = entries.filter(([, value]) => typeof value !== 'boolean').map(([name]) => name);
  if (invalid.length > 0) {
    throw new FeedError(`electronFuses entries are not booleans: ${invalid.join(', ')}`);
  }
  return Object.fromEntries(entries) as ExpectedFuses;
}

function fuseProblem(name: string, expected: boolean, wire: FuseWire): string | null {
  const index = optionIndex(name);
  if (index === undefined) {
    return `${name}: unknown fuse`;
  }
  const state = wire[index];
  const wanted = expected ? ENABLED : DISABLED;
  return state === wanted ? null : `${name}: expected ${stateLabel(wanted)}, found ${stateLabel(state)}`;
}

export function fuseProblems(expected: ExpectedFuses, wire: FuseWire): string[] {
  return Object.entries(expected)
    .map(([name, value]) => fuseProblem(name, value, wire))
    .filter((problem): problem is string => problem !== null);
}

export async function readFuseWire(appPath: string): Promise<FuseWire> {
  const config = (await fuses.getCurrentFuseWire(appPath)) as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(config).flatMap(([key, value]) => (/^\d+$/.test(key) && typeof value === 'number' ? [[Number(key), value]] : [])),
  ) as FuseWire;
}
