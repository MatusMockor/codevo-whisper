import type { PageId } from '../navigation';
import { Glyph, type GlyphName } from './Glyph';

const ICONS: Readonly<Record<PageId, GlyphName>> = {
  home: 'home',
  meetings: 'meet',
  server: 'server',
  settings: 'sliders',
  privacy: 'shield',
};

export function PageIcon({ page }: { page: PageId }) {
  return <Glyph name={ICONS[page]} size="lg" />;
}
