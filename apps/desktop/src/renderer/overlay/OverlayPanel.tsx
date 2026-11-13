import type { CSSProperties, ReactNode } from 'react';
import { offeredActions, type LiveText, type OverlayAction, type OverlayState, type OverlayTarget } from '../../shared/overlay-contract';
import { ACTION_LABELS, fallbackNotice, UNLOCK_TARGET_LABEL } from './overlay-copy';
import { barScale, formatElapsed, WAVE_BARS } from './level-history';
import { CloseIcon, MicIcon, PinIcon } from './OverlayIcons';

type RecordingState = Extract<OverlayState, { kind: 'recording' }>;
type TransientState = Extract<OverlayState, { kind: 'recording' | 'processing' }>;
type ChipModel = { action: OverlayAction; text: string; label: string; on?: boolean };

function hasWords(live: LiveText | undefined): live is LiveText {
  return live !== undefined && (live.confirmed !== '' || live.tentative !== '');
}

function panelClass(live: LiveText | undefined, plain: string): string {
  if (live === undefined) {
    return `ov ${plain}`;
  }
  return hasWords(live) ? 'ov live has-text' : 'ov live';
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

export function Notice({ text }: { text: string | undefined }) {
  if (text === undefined) {
    return null;
  }
  return <p className="ov-notice">{text}</p>;
}

type OnAction = ((action: OverlayAction) => void) | null;

const CONTROL_ICONS: Partial<Readonly<Record<OverlayAction, () => ReactNode>>> = Object.freeze({
  cancel: () => <CloseIcon />,
});

function chipsOf(state: TransientState): ChipModel[] {
  const language: ChipModel[] = state.kind === 'recording' ? [{ action: 'cycle-language', text: state.languageChip, label: `Jazyk diktovania: ${state.languageChip}` }] : [];
  const polish: ChipModel[] = state.polish === undefined ? [] : [{ action: 'toggle-polish', text: 'AI', label: state.polish ? 'AI úprava zapnutá' : 'AI úprava vypnutá', on: state.polish }];
  return [...language, ...polish];
}

export function Chips({ state, onAction }: { state: TransientState; onAction: OnAction }) {
  const offered = onAction === null ? [] : offeredActions(state);
  return chipsOf(state).map(({ action, text, label, on }) =>
    offered.includes(action) ? (
      <button key={action} type="button" className="chip" data-on={on} aria-label={label} title={label} onClick={() => onAction?.(action)}>
        {text}
      </button>
    ) : (
      <span key={action} className="chip" data-on={on} role="img" aria-label={label} title={label}>
        {text}
      </span>
    ),
  );
}

export function Controls({ state, onAction }: { state: OverlayState; onAction: OnAction }) {
  if (onAction === null) {
    return null;
  }
  return offeredActions(state).filter((action) => CONTROL_ICONS[action] !== undefined).map((action) => (
    <button key={action} type="button" className="ov-ctl" aria-label={ACTION_LABELS[action]} title={ACTION_LABELS[action]} onClick={() => onAction(action)}>
      {CONTROL_ICONS[action]?.()}
    </button>
  ));
}

function TargetChip({ target, onAction }: { target: OverlayTarget | undefined; onAction: OnAction }) {
  if (target === undefined) {
    return null;
  }
  const locked = target.lock === 'locked';
  const className = locked ? 'ov-target locked' : 'ov-target';
  const content = (
    <>
      {target.icon !== undefined && <img src={target.icon} alt="" width={16} height={16} />}
      <span className="ov-target-name">{target.name}</span>
    </>
  );
  if (target.lock === 'unavailable' || onAction === null) {
    return (
      <span className={className} title={target.name}>
        {content}
      </span>
    );
  }
  const label = `${locked ? UNLOCK_TARGET_LABEL : ACTION_LABELS['lock-target']}: ${target.name}`;
  return (
    <button type="button" className={className} aria-pressed={locked} aria-label={label} title={label} onClick={() => onAction('lock-target')}>
      {content}
      <PinIcon />
    </button>
  );
}

export function Recording({ state, levels, chips, controls, onAction }: { state: RecordingState; levels: readonly number[]; chips: ReactNode; controls: ReactNode; onAction: OnAction }) {
  const orbStyle = { '--lvl': barScale(state.level) } as CSSProperties;
  return (
    <>
      <Notice text={state.fallbackDevice === undefined ? undefined : fallbackNotice(state.fallbackDevice)} />
      <div className={`${panelClass(state.live, state.target === undefined ? 'ind' : 'ind wide')} rec`} role="status" aria-label="Nahrávam">
        <LiveWords live={state.live} />
        <div className="ov-bar">
          <span className="orb rec" style={orbStyle}>
            <MicIcon />
          </span>
          <Waveform levels={levels} />
          <span className="ov-time">{formatElapsed(state.elapsedMs)}</span>
          {chips}
          <TargetChip target={state.target} onAction={onAction} />
          {controls}
        </div>
      </div>
    </>
  );
}

export function StatusPill({ children, live }: { children: ReactNode; live?: LiveText | undefined }) {
  return (
    <div className={panelClass(live, 'pill')} role="status">
      <LiveWords live={live} />
      <div className="ov-bar">{children}</div>
    </div>
  );
}
