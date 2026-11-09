import { Fragment } from 'react';
import type { AppStatus } from '../../shared/app-status';
import type { Settings } from '../../shared/settings';
import { Glyph, type GlyphName } from '../components/Glyph';
import { Led } from '../components/Led';
import type { NavTarget } from '../navigation';
import { usePermissions } from '../settings/use-permissions';
import type { EngineIssue } from './engine-issue';
import type { Live } from './live-value';
import { ReadinessFooter } from './ReadinessFooter';
import { pathHeader, type PathHeader } from './readiness';
import { pathWires, signalPathNodes, type PathNode, type PathNodeId, type WireState } from './signal-path';
import type { SignalState, TranscriptionRoute } from './transcription-route';
import type { Dictation } from './use-dictation';

const ICONS: Readonly<Record<PathNodeId, GlyphName>> = {
  microphone: 'mic',
  hotkey: 'key',
  transcription: 'wave',
  ai: 'spark',
  insertion: 'insert',
};

const STATE_TEXT: Readonly<Record<SignalState, string>> = {
  ok: 'v poriadku',
  warn: 'upozornenie',
  err: 'problém',
  off: 'vypnuté',
};

const UNKNOWN_HEADER: PathHeader = { state: 'err', label: 'stav neznámy' };

type Navigate = (target: NavTarget) => void;

function NodeButton({ node, onNavigate }: { node: PathNode; onNavigate: Navigate }) {
  return (
    <button type="button" className={`node ${node.state}`} onClick={() => onNavigate(node.target)}>
      <span className="top">
        <span className="idx">{node.index}</span>
        <Led state={node.state} />
      </span>
      <span className="nm">
        <Glyph name={ICONS[node.id]} />
        {node.name}
      </span>
      <span className="val">
        {node.keyLabel !== null && <kbd>{node.keyLabel}</kbd>} {node.value}
      </span>
      {node.state === 'err' ? (
        <span className="fixhint">
          <Glyph name="warn" size="sm" />
          Opraviť
        </span>
      ) : (
        <span className="meta">{node.meta}</span>
      )}
      <span className="visually-hidden">, {STATE_TEXT[node.state]}</span>
    </button>
  );
}

function Wire({ state }: { state: WireState }) {
  return (
    <span className={`wire ${state}`} aria-hidden="true">
      {state === 'broken' && (
        <span className="brk">
          <Glyph name="x" />
        </span>
      )}
    </span>
  );
}

type PathRowProps = { status: AppStatus; settings: Settings; route: TranscriptionRoute; onNavigate: Navigate };

function PathRow({ status, settings, route, onNavigate }: PathRowProps) {
  const { permissions } = usePermissions();
  const nodes = signalPathNodes({ status, settings, route, permissions: permissions.kind === 'ready' ? permissions.value : null });
  const wires = pathWires(nodes, status.paused);
  return (
    <div className="sp-row">
      {nodes.map((node, position) => (
        <Fragment key={node.id}>
          {position > 0 && <Wire state={wires[position - 1] ?? 'dead'} />}
          <NodeButton node={node} onNavigate={onNavigate} />
        </Fragment>
      ))}
    </div>
  );
}

function header(status: Live<AppStatus>, issue: EngineIssue | null): PathHeader | null {
  if (status.kind === 'loading') {
    return null;
  }
  if (status.kind === 'failed') {
    return UNKNOWN_HEADER;
  }
  return pathHeader(status.value, issue);
}

export function SignalPathCard({ dictation, onNavigate }: { dictation: Dictation; onNavigate: Navigate }) {
  const { status, settings, route, issue } = dictation;
  const head = header(status, issue);
  return (
    <section className="sp" aria-labelledby="h-path">
      <div className="sp-head">
        <h2 id="h-path">
          <Led state={head?.state ?? 'off'} />
          Od klávesu po vložený text
        </h2>
        {head !== null && <span className="label-mono">{head.label}</span>}
      </div>
      {status.kind === 'ready' && settings.kind === 'ready' && route !== null && <PathRow status={status.value} settings={settings.value} route={route} onNavigate={onNavigate} />}
      <ReadinessFooter status={status} issue={issue} onNavigate={onNavigate} />
    </section>
  );
}
