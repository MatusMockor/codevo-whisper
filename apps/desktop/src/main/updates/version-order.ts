export type Version = { readonly core: readonly number[]; readonly prerelease: readonly string[] };

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const NUMERIC = /^\d+$/;

export function parseVersion(text: string): Version | null {
  const match = SEMVER.exec(text);
  if (match === null) {
    return null;
  }
  const [, major, minor, patch, prerelease] = match;
  return { core: [Number(major), Number(minor), Number(patch)], prerelease: prerelease === undefined ? [] : prerelease.split('.') };
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }
  if (aNumeric !== bNumeric) {
    return aNumeric ? -1 : 1;
  }
  return compareText(a, b);
}

function compareLists<T>(a: readonly T[], b: readonly T[], compare: (left: T, right: T) => number): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compare(a[index] as T, b[index] as T);
    if (order !== 0) {
      return order;
    }
  }
  return a.length - b.length;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    return b.length - a.length;
  }
  return compareLists(a, b, compareIdentifiers);
}

export function compareVersions(a: Version, b: Version): number {
  const core = compareLists(a.core, b.core, (left, right) => left - right);
  if (core !== 0) {
    return core;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}
