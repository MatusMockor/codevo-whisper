import type { CSSProperties } from 'react';

export function cssVars(vars: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return vars;
}
