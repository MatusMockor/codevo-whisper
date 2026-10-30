import { canCheckForUpdates, type UpdateStatus } from '../../shared/updates';

export type UpdateFooterView = { version: string; result: string | null; checking: boolean; disabled: boolean; title: string };

const CHECK_TITLE = 'Skontrolovať aktualizácie';

const UNSUPPORTED_TITLE = 'Aktualizácie fungujú iba v nainštalovanej aplikácii';

function checkResult({ phase }: UpdateStatus): string | null {
  if (phase.kind === 'checking') {
    return 'Hľadám aktualizácie…';
  }
  if (phase.kind === 'idle' && phase.checked) {
    return 'Máte najnovšiu verziu';
  }
  if (phase.kind === 'error' && phase.failed === 'check') {
    return 'Kontrola zlyhala';
  }
  return null;
}

export function updateFooterView(status: UpdateStatus): UpdateFooterView {
  const version = `Verzia ${status.currentVersion}`;
  if (status.mode === 'unsupported') {
    return { version, result: null, checking: false, disabled: true, title: UNSUPPORTED_TITLE };
  }
  return { version, result: checkResult(status), checking: status.phase.kind === 'checking', disabled: !canCheckForUpdates(status), title: CHECK_TITLE };
}
