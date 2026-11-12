import type { SupportedLanguage } from '../languages';

const LATIN = 'abcdefghijklmnopqrstuvwxyz';

const FRENCH_LOANS = 'àâçèéêëîïôûü';

const latin = (letters: string): string => LATIN + letters;

const western = (letters: string): string => latin(letters + FRENCH_LOANS);

export const ALPHABETS: Readonly<Record<SupportedLanguage, string>> = {
  bg: 'абвгдежзийклмнопрстуфхцчшщъьюяѝ',
  cs: latin('áčďéěíňóřšťúůýž'),
  da: western('æøå'),
  de: western('äöß'),
  el: 'αβγδεζηθικλμνξοπρσςτυφχψωάέήίόύώϊϋΐΰ',
  en: western(''),
  es: western('áíñóú'),
  et: western('šžõäö'),
  fi: western('åäöšž'),
  fr: western('æœùÿ'),
  hr: latin('čćđšž'),
  hu: latin('áéíóöőúüű'),
  it: western('ìíòóùú'),
  lt: latin('ąčęėįšųūž'),
  lv: latin('āčēģīķļņšūž'),
  mt: western('ċġħżìòù'),
  nl: western('áíóöú'),
  pl: latin('ąćęłńóśźż'),
  pt: western('áãíóõú'),
  ro: latin('ăâîșțşţ'),
  ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  sk: latin('áäčďéíĺľňóôŕšťúýž'),
  sl: latin('čšž'),
  sv: western('åäö'),
  uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
};
