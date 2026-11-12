import type { DictationMode } from '../../shared/settings';

export type OnboardingStep = { short: string; title: string; lead: string };

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    short: 'Mikrofón',
    title: 'Prístup k mikrofónu',
    lead: 'Codevo Whisper počuje iba to, čo nadiktujete. Mikrofón sa zapne, až keď stlačíte skratku, a po skončení diktovania sa vypne.',
  },
  {
    short: 'Povolenia',
    title: 'Monitorovanie vstupu a prístupnosť',
    lead: 'Tieto dve povolenia nastavíte v Nastaveniach systému v časti Súkromie a bezpečnosť. Stav sa tu aktualizuje sám.',
  },
  {
    short: 'Skratka',
    title: 'Klávesová skratka',
    lead: 'Zvoľte skratku na diktovanie, napríklad ⌃Space, ⌥⇧D alebo kombináciu modifikátorov.',
  },
  {
    short: 'Prepis',
    title: 'Kde bude bežať prepis',
    lead: 'Prepisovať môžete priamo na tomto Macu, aj bez internetu, alebo na vlastnom serveri, kam zvuk putuje zašifrovaný od začiatku do konca. Rozhodnúť sa môžete aj neskôr.',
  },
  {
    short: 'Vyskúšať',
    title: 'Vyskúšajte to',
    lead: 'Kliknite do poľa nižšie alebo do ľubovoľnej aplikácie a nadiktujte prvú vetu.',
  },
];

export const LINUX_ONBOARDING_STEPS: readonly OnboardingStep[] = ONBOARDING_STEPS.map((step, index) => {
  if (index === 1) return { short: 'Prístup', title: 'Prístup ku klávesnici a vkladanie', lead: 'Skontrolujte možnosti aktuálnej relácie. Linux nevyžaduje povolenia macOS. Neoverené pole znamená ručné vloženie zo schránky.' };
  if (index === 2) return { ...step, lead: 'Nahrajte skratku pre aktuálnu reláciu X11 alebo Wayland. Po zmene relácie ju nahrajte znova.' };
  if (index === 3) return { ...step, lead: 'Prepisovať môžete na tomto počítači aj bez internetu, alebo na vlastnom serveri. Rozhodnúť sa môžete aj neskôr.' };
  return step;
});

export const TRY_FINISH: Readonly<Record<DictationMode, string>> = Object.freeze({
  smart: 'Ďalším stlačením diktovanie ukončíte. Ak skratku podržíte, diktovanie skončí, keď ju pustíte.',
  hold: 'Nahráva sa, kým skratku držíte. Keď ju pustíte, text sa vloží.',
  toggle: 'Ďalším stlačením skratky diktovanie ukončíte.',
});

export type StepProgress = 'done' | 'current' | 'next';

export function stepProgress(index: number, current: number): StepProgress {
  if (index < current) {
    return 'done';
  }
  return index === current ? 'current' : 'next';
}
