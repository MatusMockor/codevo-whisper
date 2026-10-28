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
    lead: 'Zvoľte skratku na diktovanie, napríklad ⌃Space, ⌥⇧D alebo kombináciu modifikátorov.',
  },
  {
    title: 'Kde bude bežať prepis',
    lead: 'Prepisovať môžete priamo na tomto Macu, aj bez internetu, alebo na vlastnom serveri, kam zvuk putuje zašifrovaný od začiatku do konca. Rozhodnúť sa môžete aj neskôr.',
  },
  {
    title: 'Vyskúšajte to',
    lead: 'Kliknite do poľa nižšie alebo do ľubovoľnej aplikácie a nadiktujte prvú vetu.',
  },
];
