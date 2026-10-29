import type { CSSProperties, ReactNode } from 'react';
import type { BlockedReason, LiveText, OverlayAction, OverlayState } from '../../shared/overlay-contract';
import { barScale, formatElapsed, WAVE_BARS } from './level-history';
import { CheckIcon, CopyIcon, LockIcon, MarkColor, MicIcon, WarnIcon } from './OverlayIcons';

type OverlayProps = { state: OverlayState; levels: readonly number[]; onAction: (action: OverlayAction) => void };

type RecordingState = Extract<OverlayState, { kind: 'recording' }>;

const BLOCKED_TITLES: Readonly<Record<BlockedReason, string>> = Object.freeze({
  focus: 'Okno sa zmenilo, text nebol vložený',
  secure: 'Zabezpečené zadávanie, text nebol vložený',
});

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

function Message({ title, button, onClick }: { title: string; button?: string; onClick?: () => void }) {
  return (
    <div className="ov card" role="alert">
      <div className="ov-msg">
        <span className="orb err">
          <WarnIcon />
        </span>
        <p className="ov-title">{title}</p>
      </div>
      {button !== undefined && (
        <div className="ov-actions">
          <button type="button" className="ov-btn primary" onClick={onClick}>
            {button}
          </button>
        </div>
      )}
    </div>
  );
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
      <StatusPill>
        <span className="orb done">
          <CheckIcon />
        </span>
        <span className="ov-status">
          Vložené{state.appName !== '' && <small>{state.appName}</small>}
        </span>
      </StatusPill>
    );
  }
  if (state.kind === 'copied') {
    return (
      <StatusPill>
        <span className="orb done">
          <CopyIcon />
        </span>
        <span className="ov-status">{navigator.userAgent.includes('Linux') ? 'Skopírované - vlož cez Ctrl+V' : 'Skopírované - vlož cez ⌘V'}</span>
      </StatusPill>
    );
  }
  if (state.kind === 'blocked') {
    return <Message title={BLOCKED_TITLES[state.reason]} button="Kopírovať" onClick={() => onAction('copy-last')} />;
  }
  if (state.kind === 'error' && state.action === 'open-settings') {
    return <Message title={state.message} button="Otvoriť nastavenia" onClick={() => onAction('open-settings')} />;
  }
  if (state.kind === 'error' && state.action === 'open-server') {
    return <Message title={state.message} button="Otvoriť Server" onClick={() => onAction('open-server')} />;
  }
  if (state.kind === 'error' && state.action === 'copy-last') {
    return <Message title={state.message} button="Kopírovať doterajší text" onClick={() => onAction('copy-last')} />;
  }
  if (state.kind === 'error') {
    return <Message title={state.message} />;
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
