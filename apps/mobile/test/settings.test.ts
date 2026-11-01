import { expect, it } from 'vitest';
import { parseLanguage, parseSetupStatus, setupSteps } from '../src/core/settings';

it('accepts only protocol languages at the settings bridge', () => {
  expect(['auto', 'sk', 'en', 'cs'].map(parseLanguage)).toEqual(['auto', 'sk', 'en', 'cs']);
  for (const invalid of ['de', '', null, 1]) expect(() => parseLanguage(invalid)).toThrow();
});
it('acknowledges actual completed setup and distinguishes iOS applicability', () => {
  expect(setupSteps(parseSetupStatus({ microphone: true, keyboard: 'selected' }))).toEqual([]);
  expect(setupSteps(parseSetupStatus({ microphone: false, keyboard: 'disabled' }))).toEqual(['microphone', 'enableKeyboard', 'selectKeyboard']);
  expect(setupSteps(parseSetupStatus({ microphone: true, keyboard: 'enabled' }))).toEqual(['selectKeyboard']);
  expect(setupSteps(parseSetupStatus({ microphone: true, keyboard: 'notApplicable' }))).toEqual([]);
  expect(() => parseSetupStatus({ microphone: 'yes', keyboard: false })).toThrow();
});
