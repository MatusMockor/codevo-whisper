import { Glyph } from '../components/Glyph';

type OnboardingNavProps = { step: number; total: number; onBack: () => void; onNext: () => void; onDone: () => void };

function Forward({ last, onNext, onDone }: { last: boolean; onNext: () => void; onDone: () => void }) {
  if (last) {
    return (
      <button type="button" className="btn primary" onClick={onDone}>
        Dokončiť
      </button>
    );
  }
  return (
    <button type="button" className="btn primary" onClick={onNext}>
      Ďalej
      <Glyph name="arrow" size="sm" />
    </button>
  );
}

export function OnboardingNav({ step, total, onBack, onNext, onDone }: OnboardingNavProps) {
  return (
    <footer className="ob-nav">
      <div>
        {step > 0 && (
          <button type="button" className="btn" onClick={onBack}>
            Späť
          </button>
        )}
      </div>
      <div className="row-btns">
        <span className="label-mono" aria-hidden="true">
          {step + 1}/{total}
        </span>
        <Forward last={step === total - 1} onNext={onNext} onDone={onDone} />
      </div>
    </footer>
  );
}
