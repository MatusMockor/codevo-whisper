import type { OverlayAction, OverlayState } from '../../shared/overlay-contract';
import { BLOCKED_BUTTONS, BLOCKED_COPY, copiedLabel, errorButtons, errorDetail, REROUTED_DETAIL, REROUTED_TITLES } from './overlay-copy';
import { OverlayCard } from './OverlayCard';
import { CheckIcon, CopyIcon, SpinIcon, WarnIcon } from './OverlayIcons';
import { Chips, Controls, Notice, Recording, StatusPill } from './OverlayPanel';

type OverlayProps = { state: OverlayState; levels: readonly number[]; controls: boolean; onAction: (action: OverlayAction) => void };

function Content({ state, levels, controls, onAction }: OverlayProps) {
  const controlBar = <Controls state={state} onAction={controls ? onAction : null} />;
  if (state.kind === 'recording') {
    return <Recording state={state} levels={levels} chips={<Chips state={state} onAction={controls ? onAction : null} />} controls={controlBar} />;
  }
  if (state.kind === 'processing') {
    return (
      <StatusPill live={state.live}>
        <span className="orb proc">
          <SpinIcon />
        </span>
        <span className="ov-status">
          Spracúvam{state.notice === 'limit-reached' && <small>dosiahnutý limit 10 minút</small>}
        </span>
        <Chips state={state} onAction={controls ? onAction : null} />
        {controlBar}
      </StatusPill>
    );
  }
  if (state.kind === 'inserted') {
    return (
      <>
        <Notice text={state.notice} />
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
        <Notice text={state.notice} />
        <StatusPill>
          <span className="orb done">
            <CopyIcon />
          </span>
          <span className="ov-status">{copiedLabel(navigator.userAgent.includes('Linux'))}</span>
        </StatusPill>
      </>
    );
  }
  if (state.kind === 'blocked') {
    const copy = BLOCKED_COPY[state.reason];
    return <OverlayCard tone="amber" icon={<WarnIcon />} title={copy.title} detail={copy.detail} buttons={BLOCKED_BUTTONS} onAction={onAction} />;
  }
  if (state.kind === 'rerouted') {
    return <OverlayCard tone="done" icon={<CheckIcon />} title={REROUTED_TITLES[state.engine]} detail={REROUTED_DETAIL} buttons={[]} onAction={onAction} />;
  }
  if (state.kind === 'error') {
    return <OverlayCard tone="err" icon={<WarnIcon />} title={state.message} detail={errorDetail(state)} buttons={errorButtons(state)} onAction={onAction} />;
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
