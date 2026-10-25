import type { MicrophoneSetting } from '../../shared/settings';
import { bluetoothHint, microphoneOptions } from '../settings/microphone-options';
import { useMicrophoneLevel, useMicrophones } from '../settings/use-microphones';
import { LevelMeter } from './LevelMeter';

type MicrophonePickerProps = { microphone: MicrophoneSetting; onChange: (microphone: MicrophoneSetting) => void };

export function MicrophonePicker({ microphone, onChange }: MicrophonePickerProps) {
  const devices = useMicrophones();
  const meter = useMicrophoneLevel(microphone);
  const { selected, options } = microphoneOptions(devices, microphone);
  const hint = bluetoothHint(devices, microphone);

  return (
    <>
      <div className="srow">
        <div className="t">
          <b id="mic-title">Vstup</b>
          <span>Povedzte niečo a sledujte úroveň.</span>
          <LevelMeter level={meter.level} />
          {meter.failed && (
            <span className="field-note warn" role="alert">
              Mikrofón sa nepodarilo otvoriť. Skontrolujte prístup k mikrofónu v Nastaveniach systému.
            </span>
          )}
        </div>
        <select
          className="select"
          aria-labelledby="mic-title"
          value={selected}
          onChange={(event) => {
            const option = options.find((candidate) => candidate.value === event.target.value);
            if (option === undefined) {
              return;
            }
            onChange(option.microphone);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {hint !== null && (
        <div className="srow hint">
          <p className="field-note">{hint}</p>
        </div>
      )}
    </>
  );
}
