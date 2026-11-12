import { useState } from 'react';
import type { Settings } from '../../shared/settings';
import { Logo } from '../components/Logo';
import { HotkeyStep } from '../onboarding/HotkeyStep';
import { InputPermissionsStep } from '../onboarding/InputPermissionsStep';
import { MicrophoneStep } from '../onboarding/MicrophoneStep';
import { initialEngineChoice, stickyEngineChoice, type EngineChoice } from '../onboarding/engine-choice';
import { EngineStep } from '../onboarding/EngineStep';
import { OnboardingNav } from '../onboarding/OnboardingNav';
import { OnboardingStepper } from '../onboarding/OnboardingStepper';
import { LINUX_ONBOARDING_STEPS, ONBOARDING_STEPS } from '../onboarding/steps';
import { TryStep } from '../onboarding/TryStep';
import { useModels, type Models } from '../settings/use-models';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { usePermissions } from '../settings/use-permissions';
import { saveSettings } from '../settings/use-settings';

type StepBodyProps = { step: number; settings: Settings; models: Models; choice: EngineChoice | null; onEngineChoice: (choice: EngineChoice) => void };

function StepBody({ step, settings, models, choice, onEngineChoice }: StepBodyProps) {
  const { permissions, refresh } = usePermissions();
  if (step === 0) {
    return <MicrophoneStep permissions={permissions} refresh={refresh} />;
  }
  if (step === 1) {
    return <InputPermissionsStep permissions={permissions} refresh={refresh} />;
  }
  if (step === 2) {
    return <HotkeyStep settings={settings} />;
  }
  if (step === 3) {
    return <EngineStep settings={settings} models={models} choice={choice} onChoose={onEngineChoice} />;
  }
  return <TryStep settings={settings} choice={choice} />;
}

export function Onboarding({ settings }: { settings: Settings }) {
  const [step, setStep] = useState(0);
  const models = useModels();
  const [engineChoice, setEngineChoice] = useState<EngineChoice | null>(null);
  const choice = stickyEngineChoice(engineChoice, initialEngineChoice(settings, models.states));
  if (choice !== engineChoice) {
    setEngineChoice(choice);
  }
  const steps = navigator.userAgent.includes('Linux') ? LINUX_ONBOARDING_STEPS : ONBOARDING_STEPS;
  const current = steps[step] ?? steps[0];

  return (
    <div className="onboarding">
      <header className="ob-top">
        <span className="brand">
          <Logo />
          Codevo Whisper
        </span>
        <OnboardingStepper steps={steps} current={step} />
      </header>
      <main className="ob-main" aria-labelledby="ob-title">
        <div className="ob-inner">
          <p className="ob-kick">
            Krok {step + 1} z {steps.length}
          </p>
          <h1 id="ob-title">{current?.title}</h1>
          <p className="ob-lead">{current?.lead}</p>
          <SaveErrorNotice />
          <div className="ob-body">
            <StepBody step={step} settings={settings} models={models} choice={choice} onEngineChoice={setEngineChoice} />
          </div>
        </div>
      </main>
      <OnboardingNav step={step} total={steps.length} onBack={() => setStep(step - 1)} onNext={() => setStep(step + 1)} onDone={() => saveSettings({ onboardingDone: true })} />
    </div>
  );
}
