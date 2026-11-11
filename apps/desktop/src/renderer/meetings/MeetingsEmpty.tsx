import { useId } from 'react';
import { Glyph } from '../components/Glyph';
import { Led } from '../components/Led';
import type { NavTarget } from '../navigation';
import { meetingSteps, type MeetingStep } from './meeting-steps';
import { RemedyLinks } from './RemedyLinks';
import { useDiarizer, useNotesProvider } from './use-meetings';

type MeetingsEmptyProps = { modelReady: boolean | null; onNavigate: (target: NavTarget) => void };

function Step({ step, index, onNavigate }: { step: MeetingStep; index: number; onNavigate: (target: NavTarget) => void }) {
  return (
    <li className="meet-step">
      <span className="n" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <b>{step.title}</b>
      <p>{step.detail}</p>
      {step.status !== null && (
        <span className="step-status">
          <Led state={step.status.tone} />
          {step.status.label}
        </span>
      )}
      <RemedyLinks remedies={step.remedy === null ? [] : [step.remedy]} onNavigate={onNavigate} />
    </li>
  );
}

export function MeetingsEmpty({ modelReady, onNavigate }: MeetingsEmptyProps) {
  const id = useId();
  const diarizer = useDiarizer();
  const provider = useNotesProvider();
  const steps = meetingSteps({
    modelReady,
    diarizerReady: diarizer.kind === 'ready' ? diarizer.value.state.status === 'ready' : null,
    aiReady: provider === null ? null : provider !== 'none',
  });

  return (
    <section className="last meet-empty" aria-labelledby={id}>
      <div className="last-top">
        <h2 id={id}>Ako to funguje</h2>
      </div>
      <p className="empty">Zatiaľ nemáte žiadne nahrané stretnutia. Po zastavení nahrávania sa tu zobrazí aj s prepisom.</p>
      <ol className="meet-steps">
        {steps.map((step, index) => (
          <Step key={step.id} step={step} index={index} onNavigate={onNavigate} />
        ))}
      </ol>
      <p className="note meet-privacy">
        <Glyph name="lock" size="sm" />
        <span>
          Nahrávka, prepis aj poznámky ostávajú na tomto počítači. Pri poznámkach dostane AI poskytovateľ iba text prepisu.{' '}
          <button type="button" className="linkbtn" onClick={() => onNavigate({ page: 'privacy' })}>
            Kam putuje váš hlas
          </button>
        </span>
      </p>
    </section>
  );
}
