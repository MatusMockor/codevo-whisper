import { LaptopIcon, LockIcon, MicIcon, XIcon } from '../components/Icons';

const VOICE_STEPS = [
  'Mikrofón sa zapne, až keď podržíte kláves. Keď ho pustíte, vypne sa.',
  'Zvuk sa prepíše na text priamo na tomto Macu stiahnutým modelom.',
  'Nahrávka existuje iba počas prepisu a hneď potom sa zahodí.',
  'Text sa vloží do aplikácie. Posledné diktovanie ostane iba v pamäti, kým aplikáciu nezatvoríte.',
];

const NEVER = [
  'V lokálnom režime neposiela zvuk ani text na internet.',
  'Nezbiera analytiku ani telemetriu.',
  'Neuchováva zvuk v histórii prepisov.',
  'Nepotrebuje účet, e-mail ani predplatné.',
];

const STORED: ReadonlyArray<{ what: string; where: string }> = [
  { what: 'Nastavenia', where: 'settings.json' },
  { what: 'Súhrnné štatistiky po dňoch, bez textu', where: 'stats.json' },
  { what: 'Voliteľná história prepisov a jej nastavenie, lokálny nešifrovaný text', where: 'history.json' },
  { what: 'Stiahnuté modely na prepis', where: 'priečinok models' },
  { what: 'Verzia aplikácie, pre ktorú je model pripravený na rýchly štart', where: 'warm-up.json' },
];

function LocalFlow() {
  return (
    <svg className="flow" viewBox="0 0 760 210" role="img" aria-label="Schéma: mikrofón, lokálny model a vaša aplikácia sú všetky na tomto Macu. Na internet odchádza iba stiahnutie modelu a kontrola aktualizácií.">
      <rect className="mac" x="10" y="44" width="740" height="150" rx="16" />
      <text className="t3" x="30" y="70">
        Tento Mac
      </text>
      <rect className="node" x="40" y="92" width="190" height="80" rx="14" />
      <rect className="node hot" x="285" y="92" width="190" height="80" rx="14" />
      <rect className="node" x="530" y="92" width="190" height="80" rx="14" />
      <text className="t1" x="62" y="124">
        Mikrofón
      </text>
      <text className="t2" x="62" y="150">
        nahráva, kým držíte kláves
      </text>
      <text className="t1" x="307" y="124">
        Lokálny model
      </text>
      <text className="t2" x="307" y="150">
        prepíše reč na text
      </text>
      <text className="t1" x="552" y="124">
        Vaša aplikácia
      </text>
      <text className="t2" x="552" y="150">
        dostane hotový text
      </text>
      <path className="pipe" d="M232 132H283" />
      <path className="pipe" d="M477 132H528" />
      <text className="t3" x="380" y="28" textAnchor="middle">
        Na internet iba stiahnutie modelu a kontrola aktualizácií
      </text>
    </svg>
  );
}

export function Privacy({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="privacy">
      <p className="priv-lead">Váš hlas neopustí tento Mac</p>
      <p className="priv-sub">
        V lokálnom režime sa reč prepisuje priamo na tomto Macu. Zvuk ani text sa nikam neposielajú. Internet sa používa iba na stiahnutie modelu z Hugging Face, keď kliknete na Stiahnuť, a na
        kontrolu aktualizácií aplikácie.
      </p>
      <p className="priv-sub">Ak zvolíte serverový režim, zvuk sa posiela na váš spárovaný server na prepis. História prepisov ostáva iba na tomto zariadení.</p>
      <LocalFlow />
      <div className="priv-cols">
        <div>
          <h2>
            <MicIcon />
            Čo sa deje s vaším hlasom
          </h2>
          <ol className="priv-steps">
            {VOICE_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="kept priv-note">Ukazovateľ úrovne v Nastaveniach používa mikrofón iba vtedy, keď máte Nastavenia otvorené a okno aplikácie je aktívne.</p>
          <h2 className="priv-gap">
            <LaptopIcon />
            Čo sa ukladá na tomto Macu
          </h2>
          <p className="kept">Všetko je v priečinku aplikácie v ~/Library/Application Support/Codevo Whisper.</p>
          <p className="kept">História je predvolene vypnutá. Po zapnutí ukladá iba text budúcich úspešne dokončených prepisov, nikdy zvuk. Limit je 10, 50, 100 alebo 500 prepisov, predvolene 100. Najstaršie sa automaticky vymažú; nižší limit ich vymaže ihneď.</p>
          <p className="kept">V Domov môžete vymazať jeden prepis alebo celú históriu. Vypnutie v Nastaveniach vymaže históriu a zastaví ďalšie ukladanie. Vymazanie nemení súhrnné štatistiky, posledné diktovanie v pamäti ani schránku. Nejde o bezpečné prepísanie disku.</p>
          <ul className="kept-list">
            {STORED.map((item) => (
              <li key={item.what}>
                {item.what} <code>{item.where}</code>
              </li>
            ))}
          </ul>
          <button type="button" className="linkbtn" onClick={onOpenSettings}>
            Vynulovať štatistiky v Nastaveniach
          </button>
        </div>
        <div>
          <h2>
            <LockIcon />
            Čo Codevo Whisper nerobí
          </h2>
          <ul className="never">
            {NEVER.map((item) => (
              <li key={item}>
                <XIcon />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
