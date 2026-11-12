import type { CSSProperties, ReactNode } from 'react';
import type { LiveText, OverlayState } from '../../shared/overlay-contract';
import { fallbackNotice } from './overlay-copy';
import { barScale, formatElapsed, WAVE_BARS } from './level-history';
import { LockIcon, MicIcon } from './OverlayIcons';

type RecordingState = Extract<OverlayState, { kind: 'recording' }>;

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

export function Recording({ state, levels }: { state: RecordingState; levels: readonly number[] }) {
  const orbStyle = { '--lvl': barScale(state.level) } as CSSProperties;
  return (
    <>
      <Notice text={state.fallbackDevice === undefined ? undefined : fallbackNotice(state.fallbackDevice)} />
      <div className={`${panelClass(state.live, 'ind')} rec`} role="status" aria-label="Nahrávam">
        <LiveWords live={state.live} />
        <div className="ov-bar">
          <span className="orb rec" style={orbStyle}>
            <MicIcon />
          </span>
          <Waveform levels={levels} />
          <span className="ov-time">{formatElapsed(state.elapsedMs)}</span>
          <span className="chip">{state.languageChip}</span>
          <span className="ov-lock" title="Prepis beží v tomto Macu">
            <LockIcon />
          </span>
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
