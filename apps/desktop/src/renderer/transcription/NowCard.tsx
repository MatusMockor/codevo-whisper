import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import { readinessActions, remedyActions, runCommand, type CommandHandlers, type ReadinessAction } from '../home/readiness-actions';
import { EngineSwitchError } from '../settings/EngineSwitchError';
import type { NowState } from './now-state';
import type { ReadinessNote } from './readiness-note';

type NowCardProps = { state: NowState; note: ReadinessNote | null; serverHost: string | null; handlers: CommandHandlers; failure: string | null };

function Actions({ actions, handlers }: { actions: readonly ReadinessAction[]; handlers: CommandHandlers }) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="row-btns">
      {actions.map((action) => (
        <button key={action.id} type="button" className={action.primary ? 'btn primary' : 'btn'} onClick={() => runCommand(action.command, handlers)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

function Note({ note, handlers }: { note: ReadinessNote | null; handlers: CommandHandlers }) {
  if (note === null) {
    return null;
  }
  return (
    <div className="now-note">
      <Glyph name="warn" size="sm" />
      <p>{note.message}</p>
      <Actions actions={note.content === null ? [] : readinessActions(note.content).map((action) => ({ ...action, primary: false }))} handlers={handlers} />
    </div>
  );
}

export function NowCard({ state, note, serverHost, handlers, failure }: NowCardProps) {
  return (
    <>
      <div className={`now ${state.tone}`} role="status">
        <span className="lamp">
          <Led state={state.tone} large />
        </span>
        <div className="t">
          <span className="label-mono">Stav prepisu</span>
          <b>
            {state.title}
            {state.tone === 'ok' && <Glyph name="check" />}
          </b>
          <span>{state.detail}</span>
        </div>
        <Actions actions={state.remedy === null ? [] : remedyActions(state.remedy, serverHost)} handlers={handlers} />
        <Note note={note} handlers={handlers} />
      </div>
      <EngineSwitchError message={failure} />
    </>
  );
}
