import { describe, expect, it } from 'vitest';
import type { DictationMode } from '../src/shared/settings';
import { LINUX_ONBOARDING_STEPS, ONBOARDING_STEPS, stepProgress, TRY_FINISH } from '../src/renderer/onboarding/steps';
import { MODE_DESCRIPTIONS } from '../src/renderer/settings/mode-descriptions';

const DASHES = /[\u2013\u2014]/;

const MODES: readonly DictationMode[] = ['hold', 'smart', 'toggle'];

describe('onboarding steps', () => {
  it('names the five steps briefly for the step indicator on both platforms', () => {
    expect(ONBOARDING_STEPS.map((step) => step.short)).toEqual(['Mikrofón', 'Povolenia', 'Skratka', 'Prepis', 'Vyskúšať']);
    expect(LINUX_ONBOARDING_STEPS.map((step) => step.short)).toEqual(['Mikrofón', 'Prístup', 'Skratka', 'Prepis', 'Vyskúšať']);
  });

  it('describes the microphone without assuming the key is held, since smart and toggle modes latch on a tap', () => {
    const microphone = ONBOARDING_STEPS[0]?.lead ?? '';
    expect(microphone).toContain('až keď stlačíte skratku');
    expect(microphone).not.toMatch(/podržíte|pustení/);
  });

  it('explains how to finish dictating in every hotkey mode', () => {
    expect(Object.keys(TRY_FINISH).sort()).toEqual(MODES);
    expect(TRY_FINISH.smart).toContain('Ďalším stlačením');
    expect(TRY_FINISH.smart).toContain('podržíte');
    expect(TRY_FINISH.hold).toContain('držíte');
    expect(TRY_FINISH.toggle).toContain('Ďalším stlačením');
    expect(Object.keys(MODE_DESCRIPTIONS).sort()).toEqual(MODES);
  });

  it('marks earlier steps done, the shown one current and later ones next', () => {
    expect([0, 1, 2, 3, 4].map((index) => stepProgress(index, 2))).toEqual(['done', 'done', 'current', 'next', 'next']);
    expect(stepProgress(0, 0)).toBe('current');
  });

  it('never uses the long dashes in its Slovak copy', () => {
    const copy = [...ONBOARDING_STEPS, ...LINUX_ONBOARDING_STEPS].flatMap((step) => [step.short, step.title, step.lead]).concat(Object.values(TRY_FINISH), Object.values(MODE_DESCRIPTIONS));
    expect(copy.filter((text) => DASHES.test(text))).toEqual([]);
  });
});
