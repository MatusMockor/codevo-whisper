import type { SupportedLanguage } from '../languages';

const LATIN = 'abcdefghijklmnopqrstuvwxyz';

const latin = (letters: string): string => LATIN + letters;

export const ALPHABETS: Readonly<Record<SupportedLanguage, string>> = {
  bg: 'абвгдежзийклмнопрстуфхцчшщъьюяѝ',
  cs: latin('áčďéěíňóřšťúůýž'),
  da: latin('æøåé'),
  de: latin('äöüßé'),
  el: 'αβγδεζηθικλμνξοπρσςτυφχψωάέήίόύώϊϋΐΰ',
  en: latin(''),
  es: latin('áéíñóúü'),
  et: latin('šžõäöü'),
  fi: latin('åäöšž'),
  fr: latin('àâæçéèêëîïôœùûüÿ'),
  hr: latin('čćđšž'),
  hu: latin('áéíóöőúüű'),
  it: latin('àèéìíîòóùú'),
  lt: latin('ąčęėįšųūž'),
  lv: latin('āčēģīķļņšūž'),
  mt: latin('ċġħżàèìòù'),
  nl: latin('àáéèêëíïóöúü'),
  pl: latin('ąćęłńóśźż'),
  pt: latin('áâãàçéêíóôõú'),
  ro: latin('ăâîșțşţ'),
  ru: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  sk: latin('áäčďéíĺľňóôŕšťúýž'),
  sl: latin('čšž'),
  sv: latin('åäöéüà'),
  uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
};
