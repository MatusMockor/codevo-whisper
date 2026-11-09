import type { UpdateFooterView } from './update-footer';
import { Glyph } from './Glyph';

function check(): void {
  window.codevo.checkForUpdates().catch((error: unknown) => console.error('Checking for updates failed', error));
}

export function CheckUpdatesButton({ view, className }: { view: UpdateFooterView; className: string }) {
  return (
    <button type="button" className={className} aria-label="Skontrolovať aktualizácie" title={view.title} aria-busy={view.checking} disabled={view.disabled} onClick={check}>
      <Glyph name="refresh" size="sm" />
    </button>
  );
}
