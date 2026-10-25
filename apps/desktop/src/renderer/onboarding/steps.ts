export type OnboardingStep = { title: string; lead: string };

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    title: 'Prístup k mikrofónu',
    lead: 'Codevo Whisper počuje iba to, čo nadiktujete. Mikrofón sa zapne, až keď podržíte kláves, a po pustení sa vypne.',
  },
  {
    title: 'Monitorovanie vstupu a prístupnosť',
    lead: 'Tieto dve povolenia nastavíte v Nastaveniach systému v časti Súkromie a bezpečnosť. Stav sa tu aktualizuje sám.',
  },
  {
    title: 'Klávesová skratka',
    lead: 'Stlačte kláves, ktorým budete diktovať. Na klávesnici Apple odporúčame Fn / 🌐, na iných klávesniciach pravý ⌃ Control alebo pravý ⌥ Option.',
  },
  {
    title: 'Model na prepis',
    lead: 'Prepis beží priamo na tomto Macu. Model sa raz stiahne z Hugging Face a potom funguje aj bez internetu.',
  },
  {
    title: 'Vyskúšajte to',
    lead: 'Kliknite do poľa nižšie alebo do ľubovoľnej aplikácie a nadiktujte prvú vetu.',
  },
];
