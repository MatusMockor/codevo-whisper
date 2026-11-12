import { describe, expect, it } from 'vitest';
import { LanguageSelection } from '../src/language-selection';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../src/languages';
import { ALPHABETS } from '../src/text/alphabets';
import { OrthographyCheck } from '../src/text/orthography-check';
import { SK_GOVERNOR_CZECH_DRIFT, UK_DRIFT } from './support/benchmark-texts';

const check = new OrthographyCheck();

const only = (code: SupportedLanguage): LanguageSelection => LanguageSelection.of([code]);

type AlphabetRow = { code: SupportedLanguage; sentence: string; rejectedBy: SupportedLanguage };

const TABLE: AlphabetRow[] = [
  { code: 'bg', sentence: 'Днес времето е хубаво и слънчево.', rejectedBy: 'uk' },
  { code: 'cs', sentence: 'Příliš žluťoučký kůň úpěl ďábelské ódy.', rejectedBy: 'sk' },
  { code: 'da', sentence: 'Blåbærgrød med fløde er en dansk ret.', rejectedBy: 'de' },
  { code: 'de', sentence: 'Die Straße führt über den Fluss.', rejectedBy: 'en' },
  { code: 'el', sentence: 'Καλημέρα, πώς είστε σήμερα;', rejectedBy: 'ru' },
  { code: 'en', sentence: 'The quick brown fox jumps over the lazy dog.', rejectedBy: 'ru' },
  { code: 'es', sentence: 'El niño come una manzana pequeña.', rejectedBy: 'it' },
  { code: 'et', sentence: 'Õhtul läks ta jõe äärde.', rejectedBy: 'fi' },
  { code: 'fi', sentence: 'Hyvää päivää, mitä kuuluu?', rejectedBy: 'en' },
  { code: 'fr', sentence: 'Le garçon a mangé une crème brûlée.', rejectedBy: 'de' },
  { code: 'hr', sentence: 'Đak je pročitao knjigu o ćevapima.', rejectedBy: 'sl' },
  { code: 'hu', sentence: 'Az őszi szél fújja a fűzfát.', rejectedBy: 'de' },
  { code: 'it', sentence: 'Perché la città è così bella?', rejectedBy: 'de' },
  { code: 'lt', sentence: 'Ąžuolas auga prie ežero kranto.', rejectedBy: 'lv' },
  { code: 'lv', sentence: 'Ķēniņš dzīvoja lielā pilī.', rejectedBy: 'lt' },
  { code: 'mt', sentence: 'Il-ħobż huwa tajjeb ħafna.', rejectedBy: 'pl' },
  { code: 'nl', sentence: 'De ideeën van de coöperatie zijn één.', rejectedBy: 'en' },
  { code: 'pl', sentence: 'Zażółć gęślą jaźń.', rejectedBy: 'cs' },
  { code: 'pt', sentence: 'A educação não é só para crianças.', rejectedBy: 'es' },
  { code: 'ro', sentence: 'Știința și țara românească.', rejectedBy: 'it' },
  { code: 'ru', sentence: 'Съешь же ещё этих мягких булок.', rejectedBy: 'uk' },
  { code: 'sk', sentence: 'Ďateľ ľahko klope do kôry stromu.', rejectedBy: 'cs' },
  { code: 'sl', sentence: 'Čez šumeče žito je pihal veter.', rejectedBy: 'en' },
  { code: 'sv', sentence: 'Räksmörgås är gott på våren.', rejectedBy: 'de' },
  { code: 'uk', sentence: "Їжак і ґава п'ють чай.", rejectedBy: 'ru' },
];

describe('OrthographyCheck', () => {
  it('has an alphabet and a table row for every supported language', () => {
    expect(Object.keys(ALPHABETS).sort()).toEqual([...SUPPORTED_LANGUAGES]);
    expect(TABLE.map((row) => row.code)).toEqual([...SUPPORTED_LANGUAGES]);
  });

  it.each(TABLE)('$code accepts its own spelling and $rejectedBy does not', ({ code, sentence, rejectedBy }) => {
    expect(check.isConsistent(sentence, only(code))).toBe(true);
    expect(check.isConsistent(sentence.toUpperCase(), only(code))).toBe(true);
    expect(check.isConsistent(sentence, only(rejectedBy))).toBe(false);
  });

  it('accepts the union of the selected alphabets', () => {
    const czech = TABLE.find((row) => row.code === 'cs')?.sentence ?? '';

    expect(check.isConsistent(czech, LanguageSelection.of(['sk', 'cs']))).toBe(true);
    expect(check.isConsistent(SK_GOVERNOR_CZECH_DRIFT, only('sk'))).toBe(false);
    expect(check.isConsistent(SK_GOVERNOR_CZECH_DRIFT, LanguageSelection.of(['sk', 'cs']))).toBe(true);
  });

  it('rejects Cyrillic for a Latin selection and Latin for a Cyrillic one', () => {
    expect(check.isConsistent(UK_DRIFT, LanguageSelection.of(['sk', 'cs', 'en']))).toBe(false);
    expect(check.isConsistent(UK_DRIFT, LanguageSelection.of(['sk', 'uk']))).toBe(true);
    expect(check.isConsistent('Dobrý deň', LanguageSelection.of(['ru', 'uk']))).toBe(false);
  });

  it('compares decomposed input in its composed form', () => {
    expect(check.isConsistent('L̓ahko', only('sk'))).toBe(false);
    expect(check.isConsistent('Ďateľ'.normalize('NFD'), only('sk'))).toBe(true);
  });

  it.each([
    { code: 'nl', sentence: 'De enquête duurt twee à drie dagen.' },
    { code: 'sv', sentence: 'Jag äter müsli 3 à 4 gånger i veckan.' },
    { code: 'de', sentence: 'Wir treffen uns im Café.' },
    { code: 'el', sentence: 'ΤΟ ΦΕΣΤΙΒΑΛ ΞΕΚΙΝΑ ΣΤΙΣ 3 ΜΑΐΟΥ.' },
  ])('accepts common $code spelling with loan accents or capitals', ({ code, sentence }) => {
    expect(check.isConsistent(sentence, only(code as SupportedLanguage))).toBe(true);
    expect(check.isConsistent(sentence.toUpperCase(), only(code as SupportedLanguage))).toBe(true);
  });

  it('ignores digits, punctuation and spacing', () => {
    expect(check.isConsistent('19 - 20 %, (3.5)!', only('ru'))).toBe(true);
    expect(check.isConsistent('', only('sk'))).toBe(true);
  });
});
