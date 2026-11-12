export type LanguageZone = 'used' | 'available';

export type LanguageDragSource<C> = { readonly code: C; readonly from: LanguageZone };

export type LanguageDropTarget = { readonly zone: LanguageZone | null; readonly index: number };

export type LanguageDropPlan = { kind: 'none' } | { kind: 'move'; at: number } | { kind: 'add'; at: number } | { kind: 'remove' };

export function languageDropPlan<C>(source: LanguageDragSource<C>, target: LanguageDropTarget): LanguageDropPlan {
  if (target.zone === 'used') {
    return source.from === 'used' ? { kind: 'move', at: target.index } : { kind: 'add', at: target.index };
  }
  if (target.zone === 'available' && source.from === 'used') {
    return { kind: 'remove' };
  }
  return { kind: 'none' };
}

export function acceptsDrop<C>(source: LanguageDragSource<C>, zone: LanguageZone | null): boolean {
  return languageDropPlan(source, { zone, index: 0 }).kind !== 'none';
}
