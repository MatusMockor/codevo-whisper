import { useLayoutEffect, useRef } from 'react';
import type { MicrophoneSetting } from '../../shared/settings';
import { addMicrophone, bluetoothHint, microphoneView, moveMicrophone, removeMicrophone, type MicrophoneRowState } from '../settings/microphone-options';
import { useMicrophoneLevel, useMicrophones } from '../settings/use-microphones';
import { Glyph } from './Glyph';
import { LevelMeter } from './LevelMeter';

type MicrophonePickerProps = { microphones: readonly MicrophoneSetting[]; onChange: (microphones: MicrophoneSetting[]) => void };

const STATE_LABELS: Readonly<Record<MicrophoneRowState, string>> = Object.freeze({ active: 'používa sa', connected: 'pripojený', missing: 'nepripojený' });

export function MicrophonePicker({ microphones, onChange }: MicrophonePickerProps) {
  const devices = useMicrophones();
  const meter = useMicrophoneLevel(microphones);
  const view = microphoneView(devices, microphones);
  const hint = bluetoothHint(devices, microphones);
  const list = useRef<HTMLOListElement>(null);
  const add = useRef<HTMLSelectElement>(null);
  const focusAfterRemove = useRef<number | null>(null);

  useLayoutEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) {
      return;
    }
    focusAfterRemove.current = null;
    const removes = list.current?.querySelectorAll<HTMLButtonElement>('.mic-remove') ?? [];
    (removes[Math.min(index, removes.length - 1)] ?? add.current)?.focus();
  }, [microphones]);

  function remove(index: number): void {
    focusAfterRemove.current = index;
    onChange(removeMicrophone(microphones, index));
  }

  return (
    <>
      <div className="srow">
        <div className="t">
          <b id="mic-title">Vstup</b>
          <span>Nahráva sa z prvého pripojeného mikrofónu v zozname. Povedzte niečo a sledujte úroveň.</span>
          <LevelMeter level={meter.level} />
          {meter.failed && (
            <span className="field-note warn" role="alert">
              Mikrofón sa nepodarilo otvoriť. Skontrolujte prístup k mikrofónu v Nastaveniach systému.
            </span>
          )}
        </div>
        <select
          ref={add}
          className="select"
          aria-label="Pridať mikrofón"
          value=""
          disabled={view.addable.length === 0}
          onChange={(event) => {
            const chosen = view.addable.find((candidate) => candidate.deviceId === event.target.value);
            if (chosen !== undefined) {
              onChange(addMicrophone(microphones, chosen));
            }
          }}
        >
          <option value="" disabled>
            Pridať mikrofón…
          </option>
          {view.addable.map((microphone) => (
            <option key={microphone.deviceId} value={microphone.deviceId ?? ''}>
              {microphone.label}
            </option>
          ))}
        </select>
      </div>
      <div className="srow mic-order">
        {view.rows.length > 0 && (
          <ol className="mic-list" ref={list} aria-labelledby="mic-title">
            {view.rows.map((row, index) => (
              <li key={row.microphone.deviceId ?? row.microphone.label} className={`mic-item ${row.state}`}>
                <span className="mic-rank">{index + 1}</span>
                <span className="mic-name">{row.label}</span>
                <span className="mic-state">{STATE_LABELS[row.state]}</span>
                <button type="button" className="iconbtn" aria-label={`Posunúť vyššie: ${row.label}`} disabled={index === 0} onClick={() => onChange(moveMicrophone(microphones, index, -1))}>
                  <span aria-hidden="true">↑</span>
                </button>
                <button type="button" className="iconbtn" aria-label={`Posunúť nižšie: ${row.label}`} disabled={index === view.rows.length - 1} onClick={() => onChange(moveMicrophone(microphones, index, 1))}>
                  <span aria-hidden="true">↓</span>
                </button>
                <button type="button" className="iconbtn mic-remove" aria-label={`Odstrániť: ${row.label}`} onClick={() => remove(index)}>
                  <Glyph name="x" size="sm" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {view.usingDefault && (
          <p className="field-note">
            {view.rows.length === 0 ? 'Zoznam je prázdny, nahráva sa zo systémového predvoleného mikrofónu.' : 'Žiadny mikrofón zo zoznamu nie je pripojený, nahráva sa zo systémového predvoleného.'}
          </p>
        )}
      </div>
      {hint !== null && (
        <div className="srow hint">
          <p className="field-note">{hint}</p>
        </div>
      )}
    </>
  );
}
