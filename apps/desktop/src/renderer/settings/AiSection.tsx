import { useEffect, useId, useState } from 'react';
import { isAiBaseUrl, isAiKey, isLocalAddress, type AiCheck, type AiFailure, type AiKeyState } from '../../shared/ai';
import type { Settings } from '../../shared/settings';
import { Switch } from '../components/Switch';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { saveSettings } from './use-settings';

type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: AiCheck };

const FAILURES: Readonly<Record<AiFailure, string>> = {
  timeout: 'Server neodpovedal včas.',
  aborted: 'Overenie sa prerušilo.',
  unreachable: 'Server sa nepodarilo zastihnúť. Skontrolujte adresu a či server beží.',
  unauthorized: 'Server odmietol prístup. Skontrolujte API kľúč.',
  http: 'Server vrátil chybu.',
  'too-large': 'Odpoveď servera je príliš veľká.',
  'bad-response': 'Server neodpovedá ako OpenAI-compatible API.',
};

function checkMessage(result: AiCheck): string {
  if (!result.ok) return FAILURES[result.error];
  if (result.models.length === 0) return 'Spojenie funguje, server však neponúka žiadny model.';
  return `Spojenie funguje. Dostupné modely: ${result.models.length}.`;
}

function ApiKeyField({ state, onChange }: { state: AiKeyState | null; onChange: (state: AiKeyState) => void }) {
  const id = useId();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(next: string | null): void {
    window.codevo.setAiKey(next).then(
      (saved) => {
        setKey('');
        setError(null);
        onChange(saved);
      },
      (failure: unknown) => {
        console.error('Saving the AI key failed', failure);
        setError('Kľúč sa nepodarilo uložiť. Skúste to znova.');
      },
    );
  }

  const unavailable = state === 'vault-unavailable';
  const stored = state === 'stored';
  return (
    <div className="ai-field">
      <label htmlFor={id}>API kľúč (nepovinné)</label>
      <div className="ai-inline">
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={stored ? '••••••••' : ''}
          value={key}
          disabled={unavailable || stored || state === null}
          aria-describedby={`${id}-note`}
          onChange={(event) => {
            setKey(event.target.value);
            setError(null);
          }}
        />
        {stored ? (
          <button type="button" className="btn ghost" onClick={() => save(null)}>
            Odstrániť kľúč
          </button>
        ) : (
          <button type="button" className="btn" disabled={unavailable || !isAiKey(key.trim())} onClick={() => save(key.trim())}>
            Uložiť kľúč
          </button>
        )}
      </div>
      <span className={unavailable ? 'field-note warn' : 'field-note'} id={`${id}-note`}>
        {stored ? 'Kľúč je uložený v systémovom úložisku.' : unavailable ? 'Bezpečné úložisko systému nie je dostupné, kľúč sa preto nedá uložiť. Server bez kľúča funguje aj tak.' : 'Lokálne servery ako Ollama kľúč nepotrebujú.'}
      </span>
      {error !== null && <p className="field-note warn" role="alert">{error}</p>}
    </div>
  );
}

export function AiSection({ settings }: { settings: Pick<Settings, 'aiBaseUrl' | 'aiModel' | 'aiPolish'> }) {
  const urlId = useId();
  const modelId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [keyState, setKeyState] = useState<AiKeyState | null>(null);

  useEffect(() => {
    window.codevo.getAiKeyState().then(setKeyState, (error: unknown) => console.error('Reading the AI key state failed', error));
  }, []);

  const urlValue = (url ?? settings.aiBaseUrl ?? '').trim();
  const modelValue = (model ?? settings.aiModel).trim();
  const urlValid = urlValue === '' || isAiBaseUrl(urlValue);
  const ready = urlValue !== '' && urlValid && modelValue !== '';
  const models = check.kind === 'done' && check.result.ok ? check.result.models : [];

  function saveUrl(): void {
    if (!urlValid || urlValue === (settings.aiBaseUrl ?? '')) return;
    const aiBaseUrl = urlValue === '' ? null : urlValue;
    saveSettings({ aiBaseUrl, ...(aiBaseUrl === null ? { aiPolish: false } : {}) }, (saved) => saved && setUrl(null));
  }

  function saveModel(): void {
    if (modelValue === settings.aiModel) return;
    saveSettings({ aiModel: modelValue, ...(modelValue === '' ? { aiPolish: false } : {}) }, (saved) => saved && setModel(null));
  }

  function verify(): void {
    saveUrl();
    setCheck({ kind: 'checking' });
    window.codevo.checkAi(urlValue).then(
      (result) => setCheck({ kind: 'done', result }),
      (error: unknown) => {
        console.error('Checking the AI server failed', error);
        setCheck({ kind: 'done', result: { ok: false, error: 'unreachable' } });
      },
    );
  }

  return (
    <SettingsGroup title="AI úprava textu">
      <p className="sbox-lead">Po prepise môže diktát upraviť jazykový model na serveri, ktorý si nastavíte, napríklad Ollama alebo LM Studio. Bez adresy sa text nikam neposiela.</p>
      <div className="ai-fields">
        <div className="ai-field">
          <label htmlFor={urlId}>Adresa servera (OpenAI-compatible)</label>
          <input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://127.0.0.1:11434/v1"
            value={url ?? settings.aiBaseUrl ?? ''}
            aria-invalid={!urlValid}
            aria-describedby={`${urlId}-note`}
            onChange={(event) => {
              setUrl(event.target.value);
              setCheck({ kind: 'idle' });
            }}
            onBlur={saveUrl}
            onKeyDown={(event) => event.key === 'Enter' && saveUrl()}
          />
          <span id={`${urlId}-note`} className={urlValid && (urlValue === '' || isLocalAddress(urlValue)) ? 'field-note' : 'field-note warn'} role={urlValid ? undefined : 'alert'}>
            {!urlValid ? 'Zadajte adresu začínajúcu http:// alebo https://, bez mena, hesla a parametrov.' : urlValue !== '' && !isLocalAddress(urlValue) ? 'Text sa odošle mimo tento počítač.' : 'Adresa končí spravidla na /v1.'}
          </span>
        </div>
        <div className="ai-field">
          <label htmlFor={modelId}>Model</label>
          <input
            id={modelId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            list={`${modelId}-list`}
            placeholder="qwen2.5:1.5b"
            value={model ?? settings.aiModel}
            onChange={(event) => setModel(event.target.value)}
            onBlur={saveModel}
            onKeyDown={(event) => event.key === 'Enter' && saveModel()}
          />
          <datalist id={`${modelId}-list`}>
            {models.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <ApiKeyField state={keyState} onChange={setKeyState} />
        <div className="ai-inline">
          <button type="button" className="btn" disabled={urlValue === '' || !urlValid || check.kind === 'checking'} onClick={verify}>
            {check.kind === 'checking' ? 'Overuje sa…' : 'Overiť pripojenie'}
          </button>
          <span className={check.kind === 'done' && !check.result.ok ? 'field-note warn' : 'field-note'} aria-live="polite">
            {check.kind === 'done' ? checkMessage(check.result) : ''}
          </span>
        </div>
      </div>
      <SettingsRow title="Upraviť diktát cez AI" description="Odstráni zaváhania, opraví interpunkciu a zachová jazyk. Ak server neodpovie do 8 sekúnd, vloží sa pôvodný prepis.">
        <Switch
          label="Upraviť diktát cez AI"
          checked={settings.aiPolish && ready}
          disabled={!ready}
          onChange={(aiPolish) => saveSettings({ aiBaseUrl: urlValue, aiModel: modelValue, aiPolish }, (saved) => {
            if (!saved) return;
            setUrl(null);
            setModel(null);
          })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
