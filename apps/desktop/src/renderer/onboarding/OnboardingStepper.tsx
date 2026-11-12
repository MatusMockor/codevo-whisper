import { Glyph } from '../components/Glyph';
import { stepProgress, type OnboardingStep } from './steps';

function StepMark({ index, done }: { index: number; done: boolean }) {
  if (done) {
    return (
      <span className="no" aria-hidden="true">
        <Glyph name="check" size="sm" />
      </span>
    );
  }
  return (
    <span className="no" aria-hidden="true">
      {index + 1}
    </span>
  );
}

export function OnboardingStepper({ steps, current }: { steps: readonly OnboardingStep[]; current: number }) {
  return (
    <ol className="ob-steps" aria-label="Kroky nastavenia">
      {steps.map((step, index) => {
        const progress = stepProgress(index, current);
        return (
          <li key={step.short} className={progress} aria-current={progress === 'current' ? 'step' : undefined}>
            <StepMark index={index} done={progress === 'done'} />
            <span className="lbl">{step.short}</span>
          </li>
        );
      })}
    </ol>
  );
}
