export function nextInRotation<K>(keys: K[], last: K | undefined, eligible: (key: K) => boolean): K | undefined {
  const start = last === undefined ? 0 : keys.indexOf(last) + 1;
  for (let step = 0; step < keys.length; step += 1) {
    const key = keys[(start + step) % keys.length];
    if (key !== undefined && eligible(key)) {
      return key;
    }
  }
  return undefined;
}
