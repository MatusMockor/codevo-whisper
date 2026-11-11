export type GroupPosition<T extends string> = { id: T; top: number };

export function pickActiveGroup<T extends string>(positions: readonly GroupPosition<T>[], line: number, atEnd: boolean): T | null {
  if (atEnd) {
    return positions.at(-1)?.id ?? null;
  }
  const passed = positions.filter((position) => position.top <= line);
  return (passed.at(-1) ?? positions[0])?.id ?? null;
}
