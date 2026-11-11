import { useId } from 'react';
import { Glyph } from '../components/Glyph';
import { METER_NOTE, NEVER, VOICE_STEPS } from './privacy-copy';

export function VoiceCard() {
  const voiceId = useId();
  const neverId = useId();
  return (
    <div className="last priv-card">
      <section aria-labelledby={voiceId}>
        <div className="last-top">
          <h2 id={voiceId}>
            <Glyph name="mic" size="sm" />
            Čo sa deje s vaším hlasom
          </h2>
        </div>
        <ol className="priv-steps">
          {VOICE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="note">{METER_NOTE}</p>
      </section>
      <section className="priv-never" aria-labelledby={neverId}>
        <div className="last-top">
          <h2 id={neverId}>
            <Glyph name="lock" size="sm" />
            Čo Codevo Whisper nerobí
          </h2>
        </div>
        <ul className="never">
          {NEVER.map((item) => (
            <li key={item}>
              <Glyph name="x" size="sm" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
