import type { CSSProperties, ReactNode } from 'react';
import { offeredActions, type BlockedReason, type LiveText, type OverlayAction, type OverlayState } from '../../shared/overlay-contract';
import type { EngineId } from '../../shared/settings';
import { barScale, formatElapsed, WAVE_BARS } from './level-history';
import { CheckIcon, CopyIcon, LockIcon, MarkColor, MicIcon, WarnIcon } from './OverlayIcons';

type OverlayProps = { state: OverlayState; levels: readonly number[]; onAction: (action: OverlayAction) => void };

type RecordingState = Extract<OverlayState, { kind: 'recording' }>;

const BLOCKED_TITLES: Readonly<Record<BlockedReason, string>> = Object.freeze({
  focus: 'Okno sa zmenilo, text nebol vložený',
  secure: 'Zabezpečené zadávanie, text nebol vložený',
});

const ACTION_LABELS: Readonly<Record<OverlayAction, string>> = Object.freeze({
  'open-settings': 'Otvoriť nastavenia',
  'open-server': 'Otvoriť Server',
  'copy-last': 'Kopírovať doterajší text',
  'pair-server': 'Spárovať server',
  'download-model': 'Stiahnuť model',
  'use-server': 'Prepisovať na serveri',
  'use-local': 'Prepisovať lokálne',
});

const REROUTED_TITLES: Readonly<Record<EngineId, string>> = Object.freeze({
  server: 'Prepis teraz beží na serveri',
  local: 'Prepis teraz beží lokálne',
});

type MessageButton = { label: string; action: OverlayAction; primary: boolean };

function fallbackNotice(device: string): string {
  if (device === '') {
    return 'Vybraný mikrofón nie je pripojený, používam predvolený';
  }
  return `Mikrofón ${device} nie je pripojený, používam predvolený`;
}

function Waveform({ levels }: { levels: readonly number[] }) {
  const padded = [...Array<number>(Math.max(0, WAVE_BARS - levels.length)).fill(0), ...levels];
  return (
    <div className="wave" aria-hidden="true">
      {padded.map((level, index) => (
        <i key={index} style={{ transform: `scaleY(${barScale(level)})` }} />
      ))}
    </div>
  );
}

function hasWords(live: LiveText | undefined): live is LiveText {
  return live !== undefined && (live.confirmed !== '' || live.tentative !== '');
}

function panelClass(live: LiveText | undefined, plain: string): string {
  if (live === undefined) {
    return `ov ${plain}`;
  }
  return hasWords(live) ? 'ov live has-text' : 'ov live';
}

function LiveWords({ live }: { live: LiveText | undefined }) {
  if (!hasWords(live)) {
    return null;
  }
  return (
    <div className="ov-text">
      <p className="lines">
        {live.confirmed !== '' && <span className="w">{live.confirmed}</span>}
        {live.confirmed !== '' && live.tentative !== '' && ' '}
        {live.tentative !== '' && <span className="w t">{live.tentative}</span>}
      </p>
    </div>
  );
}

function Recording({ state, levels }: { state: RecordingState; levels: readonly number[] }) {
  const orbStyle = { '--lvl': barScale(state.level) } as CSSProperties;
  return (
    <>
      {state.fallbackDevice !== undefined && <p className="ov-notice">{fallbackNotice(state.fallbackDevice)}</p>}
      <div className={panelClass(state.live, 'ind')} role="status" aria-label="Nahrávam">
        <LiveWords live={state.live} />
        <div className="ov-bar">
          <span className="orb rec" style={orbStyle}>
            <MicIcon />
          </span>
          <Waveform levels={levels} />
          <span className="ov-time">{formatElapsed(state.elapsedMs)}</span>
          <span className="chip">{state.language}</span>
          <span className="ov-lock" title="Prepis beží v tomto Macu">
            <LockIcon />
          </span>
        </div>
      </div>
    </>
  );
}

function StatusPill({ children, live }: { children: ReactNode; live?: LiveText | undefined }) {
  return (
    <div className={panelClass(live, 'pill')} role="status">
      <LiveWords live={live} />
      <div className="ov-bar">{children}</div>
    </div>
  );
}

function Message({ title, buttons, onAction }: { title: string; buttons: readonly MessageButton[]; onAction: (action: OverlayAction) => void }) {
  return (
    <div className="ov card" role="alert">
      <div className="ov-msg">
        <span className="orb err">
          <WarnIcon />
        </span>
        <p className="ov-title">{title}</p>
      </div>
      {buttons.length > 0 && (
        <div className="ov-actions">
          {buttons.map((button) => (
            <button key={button.action} type="button" className={button.primary ? 'ov-btn primary' : 'ov-btn'} onClick={() => onAction(button.action)}>
              {button.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Rerouted({ engine }: { engine: EngineId }) {
  return (
    <div className="ov card" role="status">
      <div className="ov-msg">
        <span className="orb done">
          <CheckIcon />
        </span>
        <div>
          <p className="ov-title">{REROUTED_TITLES[engine]}</p>
          <p className="ov-sub">Stlačte skratku a diktujte znova.</p>
        </div>
      </div>
    </div>
  );
}

function errorButtons(state: OverlayState): MessageButton[] {
  return offeredActions(state)
    .map((action, index) => ({ action, label: ACTION_LABELS[action], primary: index === 0 }))
    .reverse();
}

function Content({ state, levels, onAction }: OverlayProps) {
  if (state.kind === 'recording') {
    return <Recording state={state} levels={levels} />;
  }
  if (state.kind === 'processing') {
    return (
      <StatusPill live={state.live}>
        <span className="orb proc">
          <MarkColor />
        </span>
        <span className="ov-status">
          Spracúvam{state.notice === 'limit-reached' && <small>dosiahnutý limit 10 minút</small>}
        </span>
      </StatusPill>
    );
  }
  if (state.kind === 'inserted') {
    return (
      <>
        {state.notice !== undefined && <p className="ov-notice">{state.notice}</p>}
        <StatusPill>
          <span className="orb done">
            <CheckIcon />
          </span>
          <span className="ov-status">
            Vložené{state.appName !== '' && <small>{state.appName}</small>}
          </span>
        </StatusPill>
      </>
    );
  }
  if (state.kind === 'copied') {
    return (
      <>
        {state.notice !== undefined && <p className="ov-notice">{state.notice}</p>}
        <StatusPill>
          <span className="orb done">
            <CopyIcon />
          </span>
          <span className="ov-status">{navigator.userAgent.includes('Linux') ? 'Skopírované - vlož cez Ctrl+V' : 'Skopírované - vlož cez ⌘V'}</span>
        </StatusPill>
      </>
    );
  }
  if (state.kind === 'blocked') {
    return <Message title={BLOCKED_TITLES[state.reason]} buttons={[{ action: 'copy-last', label: 'Kopírovať', primary: true }]} onAction={onAction} />;
  }
  if (state.kind === 'rerouted') {
    return <Rerouted engine={state.engine} />;
  }
  if (state.kind === 'error') {
    return <Message title={state.message} buttons={errorButtons(state)} onAction={onAction} />;
  }
  return null;
}

export function Overlay(props: OverlayProps) {
  return (
    <div className="stage" data-state={props.state.kind}>
      <Content {...props} />
    </div>
  );
}
