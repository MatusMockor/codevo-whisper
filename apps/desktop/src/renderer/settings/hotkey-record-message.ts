export type HotkeyRecordProblem = 'unsupported' | 'conflict' | 'timeout' | 'failed' | 'cancelled';

const MESSAGES: Readonly<Record<HotkeyRecordProblem, string | null>> = {
  unsupported: 'Túto skratku nemožno použiť. Zvoľte modifikátory alebo modifikátory s jedným klávesom. ⌃⌘V je vyhradená na vloženie posledného prepisu.',
  conflict: 'Táto skratka sa prekrýva so skratkou na diktovanie alebo s druhou skratkou počas diktovania. Zvoľte inú.',
  cancelled: null,
  timeout: 'Nestlačili ste žiadny kláves. Skúste to znova.',
  failed: 'Kláves sa nepodarilo zaznamenať. Skontrolujte povolenie Monitorovanie vstupu.',
};

export function hotkeyRecordMessage(problem: HotkeyRecordProblem): string | null {
  return MESSAGES[problem];
}
