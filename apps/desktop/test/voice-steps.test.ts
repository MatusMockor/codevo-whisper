import { describe, expect, it } from 'vitest';
import { voiceSteps } from '../src/renderer/privacy/voice-steps';

describe('voiceSteps', () => {
  it('opens the microphone only for the dictation, in every dictation mode', () => {
    expect(voiceSteps(null)[0]).toBe('Mikrofón sa zapne, až keď spustíte diktovanie skratkou, a vypne sa hneď, ako diktovanie skončí.');
  });

  it('describes where the voice is transcribed on the current route', () => {
    expect(voiceSteps({ primary: 'local', fallback: null })[1]).toBe('Zvuk sa prepíše na text priamo na tomto počítači stiahnutým modelom.');
    expect(voiceSteps({ primary: 'server', fallback: null })[1]).toBe('Zvuk ide zašifrovaný (E2E) na váš server, ktorý vráti text.');
    expect(voiceSteps({ primary: 'server', fallback: 'local' })[1]).toBe('Zvuk ide zašifrovaný (E2E) na váš server, ktorý vráti text. Ak server nie je dostupný, prepíše sa na tomto počítači.');
    expect(voiceSteps({ primary: 'local', fallback: 'server' })[1]).toBe('Zvuk sa prepíše na text priamo na tomto počítači stiahnutým modelom. Ak lokálny prepis nie je pripravený, ide zašifrovaný na váš server.');
    expect(voiceSteps(null)[1]).toBe('Zvuk sa prepíše na tomto počítači alebo zašifrovaný na vašom serveri, podľa trasy prepisu.');
  });

  it('discards only the dictation audio and keeps meeting recordings until they are deleted', () => {
    expect(voiceSteps(null)[2]).toBe('Zvuk diktátu existuje iba počas prepisu a hneď potom sa zahodí. Nahrávky stretnutí ostávajú v meetings/, kým ich nevymažete.');
  });

  it('keeps the copy free of long dashes', () => {
    const routes = [null, { primary: 'local', fallback: 'server' }, { primary: 'server', fallback: 'local' }] as const;
    expect(routes.flatMap((route) => voiceSteps(route)).filter((step) => /[–—]/.test(step))).toEqual([]);
  });
});
