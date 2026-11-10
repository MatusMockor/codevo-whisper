import type { SectionFocus } from '../windows/section-focus';
import type { HandlerGroup } from './invoke-handlers';
import { withoutArguments } from './without-arguments';

export type FocusHandlerDeps = { sectionFocus: Pick<SectionFocus, 'take'> };

export function focusHandlers({ sectionFocus }: FocusHandlerDeps): HandlerGroup<'takeSectionFocus'> {
  return {
    takeSectionFocus: withoutArguments(() => sectionFocus.take()),
  };
}
