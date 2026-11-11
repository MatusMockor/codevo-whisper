import type { PageId } from '../navigation';
import type { GlyphName } from './glyph-name';

export const PAGE_GLYPHS: Readonly<Record<PageId, GlyphName>> = {
  home: 'home',
  meetings: 'meet',
  transcription: 'route',
  settings: 'sliders',
  privacy: 'shield',
};
