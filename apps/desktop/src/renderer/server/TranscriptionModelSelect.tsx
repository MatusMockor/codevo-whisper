import { useState } from 'react';
import type { ModelPicker } from './transcription-model-picker';

export function TranscriptionModelSelect({ picker, labelId }: { picker: ModelPicker; labelId: string }) {
  const [failed, setFailed] = useState(false);

  function choose(id: string): void {
    const option = picker.options.find((choice) => choice.id === id && !choice.disabled);
    if (option === undefined) {
      return;
    }
    setFailed(false);
    window.codevo.chooseServerModel(option.id).catch((error: unknown) => {
      console.error('Choosing the server transcription model failed', error);
      setFailed(true);
    });
  }

  return (
    <>
      <select className="select" aria-labelledby={labelId} value={picker.selected} onChange={(event) => choose(event.target.value)}>
        {picker.options.map((option) => (
          <option key={option.id} value={option.id} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {picker.description !== null && <p className="field-note">{picker.description}</p>}
      {picker.missingNote !== null && <p className="field-note warn">{picker.missingNote}</p>}
      {failed && (
        <p className="field-note warn" role="alert">
          Model sa nepodarilo uložiť.
        </p>
      )}
    </>
  );
}
