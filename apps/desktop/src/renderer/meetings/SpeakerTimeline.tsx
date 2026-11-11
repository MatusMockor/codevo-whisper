import type { Turn } from '../../shared/meetings';
import { speakerTimeline } from './speaker-lanes';

export function SpeakerTimeline({ turns, durationMs }: { turns: readonly Turn[]; durationMs: number }) {
  const { lanes, marks } = speakerTimeline(turns, durationMs);
  if (lanes.length === 0) {
    return null;
  }
  return (
    <div className="lanes" role="img" aria-label={`Časová os hovoriacich: ${lanes.map((lane) => lane.speaker).join(', ')}`}>
      {lanes.map((lane) => (
        <div key={lane.speaker} className={`lane spk-${lane.tone}`}>
          <span className="who">
            <i />
            {lane.speaker}
          </span>
          <span className="trk">
            {lane.spans.map((span, index) => (
              <span key={index} style={{ left: `${span.start}%`, width: `${span.width}%` }} />
            ))}
          </span>
        </div>
      ))}
      <div className="ruler">
        {marks.map((mark, index) => (
          <span key={index}>{mark}</span>
        ))}
      </div>
    </div>
  );
}
