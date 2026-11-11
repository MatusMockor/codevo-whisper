import { useId } from 'react';
import { formatClock, type MeetingSummary } from '../../shared/meetings';
import { Led } from '../components/Led';
import { phaseLabel, phaseTone } from './meeting-copy';

type MeetingListProps = { meetings: readonly MeetingSummary[]; selectedId: string | null; onSelect: (id: string) => void };

export function MeetingList({ meetings, selectedId, onSelect }: MeetingListProps) {
  const id = useId();
  return (
    <section className="last meeting-list-card" aria-labelledby={id}>
      <div className="last-top">
        <h2 id={id}>Nahrané stretnutia</h2>
        <span className="label-mono">{meetings.length}</span>
      </div>
      <ol className="meeting-list" aria-label="Nahrané stretnutia">
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <button type="button" className="meeting-pick" aria-current={meeting.id === selectedId ? 'true' : undefined} onClick={() => onSelect(meeting.id)}>
              <b>{meeting.title}</b>
              <span className="meeting-meta">
                <Led state={phaseTone(meeting.phase)} />
                {formatClock(meeting.durationMs)} · {phaseLabel(meeting.phase)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
