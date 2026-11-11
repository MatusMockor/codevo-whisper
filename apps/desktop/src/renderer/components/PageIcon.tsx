import type { PageId } from '../navigation';
import { Glyph } from './Glyph';
import { PAGE_GLYPHS } from './page-glyphs';

export function PageIcon({ page }: { page: PageId }) {
  return <Glyph name={PAGE_GLYPHS[page]} size="lg" />;
}
