import type { EngineId } from '../../shared/settings';
import type { VoiceRoute } from './privacy-zones';

const MICROPHONE_STEP = 'Mikrofón sa zapne, až keď spustíte diktovanie skratkou, a vypne sa hneď, ako diktovanie skončí.';

const TRANSCRIBE_STEP: Readonly<Record<EngineId, string>> = Object.freeze({
  local: 'Zvuk sa prepíše na text priamo na tomto počítači stiahnutým modelom.',
  server: 'Zvuk ide zašifrovaný (E2E) na váš server, ktorý vráti text.',
});

const FALLBACK_STEP: Readonly<Record<EngineId, string>> = Object.freeze({
  local: 'Ak server nie je dostupný, prepíše sa na tomto počítači.',
  server: 'Ak lokálny model chýba, ide zašifrovaný na váš server.',
});

const UNKNOWN_ROUTE_STEP = 'Zvuk sa prepíše na tomto počítači alebo zašifrovaný na vašom serveri, podľa trasy prepisu.';

const DISCARD_STEP = 'Zvuk diktátu existuje iba počas prepisu a hneď potom sa zahodí. Nahrávky stretnutí ostávajú v meetings/, kým ich nevymažete.';

const INSERT_STEP = 'Text sa vloží do aplikácie. Posledné diktovanie ostane iba v pamäti, kým aplikáciu nezatvoríte.';

function transcribeStep(route: VoiceRoute): string {
  if (route === null) {
    return UNKNOWN_ROUTE_STEP;
  }
  if (route.fallback === null) {
    return TRANSCRIBE_STEP[route.primary];
  }
  return `${TRANSCRIBE_STEP[route.primary]} ${FALLBACK_STEP[route.fallback]}`;
}

export function voiceSteps(route: VoiceRoute): readonly string[] {
  return [MICROPHONE_STEP, transcribeStep(route), DISCARD_STEP, INSERT_STEP];
}
