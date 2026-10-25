export type HotkeyRecordProblem = 'unsupported' | 'timeout' | 'failed';

const MESSAGES: Readonly<Record<HotkeyRecordProblem, string>> = {
  unsupported: 'Tento kláves sa nedá použiť. Zvoľte Fn / 🌐, pravý ⌃ Control, ľavý alebo pravý ⌥ Option, alebo pravý ⌘ Command.',
  timeout: 'Nestlačili ste žiadny kláves. Skúste to znova.',
  failed: 'Kláves sa nepodarilo zaznamenať. Skontrolujte povolenie Monitorovanie vstupu.',
};

export function hotkeyRecordMessage(problem: HotkeyRecordProblem): string {
  return MESSAGES[problem];
}
