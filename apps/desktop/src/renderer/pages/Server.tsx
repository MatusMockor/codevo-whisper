import { LockIcon, PlusIcon, ServerIcon } from '../components/Icons';

const CODE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function Server() {
  return (
    <div className="server">
      <div className="card">
        <div className="srv-top">
          <span className="srv-ic">
            <ServerIcon />
          </span>
          <div>
            <h2>Vlastný server</h2>
            <p>Serverový režim príde v ďalšej verzii.</p>
          </div>
          <span className="pill soon-pill">Pripravujeme</span>
        </div>
        <p className="srv-text">
          Codevo Whisper bude vedieť prepisovať aj na serveri, ktorý vlastníte, napríklad na domácom počítači s grafickou kartou. Zvuk aj text sa zašifrujú už na tomto Macu a server
          ich po prepise hneď zabudne. Dovtedy všetko beží lokálne na tomto Macu.
        </p>
        <div className="e2e">
          <span className="e2e-badge">
            <LockIcon />
            End-to-end šifrované
          </span>
          <p>Cesta k serveru cez domácu sieť, WireGuard alebo Cloudflare tunel uvidí iba šifrované dáta.</p>
        </div>
      </div>

      <div className="pair card" aria-disabled="true">
        <div className="pair-head">
          <h2>Spárovať nový server</h2>
          <button type="button" className="btn ghost" disabled>
            <PlusIcon />
            Spárovať nový server
          </button>
        </div>
        <ol className="steps">
          <li>
            <div>
              <p>Na serveri spustite príkaz</p>
              <div className="term">
                <div>
                  <span className="pr">$</span> codevo-whisper pair
                </div>
              </div>
            </div>
          </li>
          <li>
            <div>
              <p>Opíšte kód z terminálu</p>
              <div className="code-in" role="group" aria-label="Párovací kód, 8 znakov">
                {CODE_SLOTS.map((slot) => (
                  <input key={slot} aria-label={`Znak ${slot}`} maxLength={1} autoComplete="off" disabled />
                ))}
                <button type="button" className="btn primary" disabled>
                  Spárovať
                </button>
              </div>
            </div>
          </li>
          <li>
            <div>
              <p>Porovnajte odtlačok s tým, čo ukazuje terminál</p>
              <p className="note">Párovanie bude dostupné v ďalšej verzii.</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
