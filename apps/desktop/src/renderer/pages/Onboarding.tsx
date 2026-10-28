import { useState } from 'react';
import type { Settings } from '../../shared/settings';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { Logo } from '../components/Logo';
import { InputPermissionsStep } from '../onboarding/InputPermissionsStep';
import { MicrophoneStep } from '../onboarding/MicrophoneStep';
import { ModelStep } from '../onboarding/ModelStep';
import { ONBOARDING_STEPS } from '../onboarding/steps';
import { TryStep } from '../onboarding/TryStep';
import { useModels } from '../settings/use-models';
import { SaveErrorNotice } from '../settings/SaveErrorNotice';
import { usePermissions } from '../settings/use-permissions';
import { saveSettings } from '../settings/use-settings';

const LAST_STEP = ONBOARDING_STEPS.length - 1;

function StepBody({ step, settings }: { step: number; settings: Settings }) {
  const { permissions, refresh } = usePermissions();
  const models = useModels();
  if (step === 0) {
    return <MicrophoneStep permissions={permissions} refresh={refresh} />;
  }
  if (step === 1) {
    return <InputPermissionsStep permissions={permissions} refresh={refresh} />;
  }
  if (step === 2) {
    return (
      <div className="ob-hotkey">
        <span id="ob-hotkey-title" className="visually-hidden">
          Klávesová skratka
        </span>
        <HotkeyRecorder hotkey={settings.hotkey} labelledBy="ob-hotkey-title" onRecorded={(hotkey) => saveSettings({ hotkey })} />
      </div>
    );
  }
  if (step === 3) {
    return <ModelStep settings={settings} models={models} />;
  }
  const modelReady = models.states.some((state) => state.id === settings.localModelId && state.status === 'ready');
  return <TryStep settings={settings} modelReady={modelReady} />;
}

export function Onboarding({ settings }: { settings: Settings }) {
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];

  return (
    <div className="onboarding">
      <header className="ob-bar">
        <span className="brand">
          <Logo />
          Codevo Whisper
        </span>
      </header>
      <main className="ob-main" aria-labelledby="ob-title">
        <p className="ob-step">
          Krok {step + 1} z {ONBOARDING_STEPS.length}
        </p>
        <h1 id="ob-title">{current?.title}</h1>
        <p className="ob-lead">{current?.lead}</p>
        <SaveErrorNotice />
        <div className="ob-body">
          <StepBody step={step} settings={settings} />
        </div>
        <div className="ob-nav">
          {step > 0 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              Späť
            </button>
          )}
          {step < LAST_STEP && (
            <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
              Ďalej
            </button>
          )}
          {step === LAST_STEP && (
            <button type="button" className="btn primary" onClick={() => saveSettings({ onboardingDone: true })}>
              Dokončiť
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
