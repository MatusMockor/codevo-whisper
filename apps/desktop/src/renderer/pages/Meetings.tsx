import { useState } from 'react';
import { MeetingDetail } from '../meetings/MeetingDetail';
import { formatClock, phaseLabel } from '../meetings/meeting-copy';
import { RecordCard } from '../meetings/RecordCard';
import { SpeakersCard } from '../meetings/SpeakersCard';
import { useLocalModelReady, useMeetings } from '../meetings/use-meetings';

export function Meetings({ onOpenSettings }: { onOpenSettings: () => void }) {
  const meetings = useMeetings();
  const modelReady = useLocalModelReady();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = meetings.kind === 'ready' ? meetings.value : [];
  const recording = list.find((meeting) => meeting.phase.kind === 'recording') ?? null;
  const recorded = list.filter((meeting) => meeting.phase.kind !== 'recording');
  const selected = recorded.find((meeting) => meeting.id === selectedId) ?? recorded[0] ?? null;

  return (
    <div className="meetings">
      <RecordCard recording={recording} modelReady={modelReady} onOpenSettings={onOpenSettings} />
      <SpeakersCard />
      <section className="last history" aria-labelledby="h-meetings">
        <div className="last-top">
          <h2 id="h-meetings">Nahrané stretnutia</h2>
        </div>
        {meetings.kind === 'loading' ? (
          <p className="empty" role="status">
            Načítavajú sa stretnutia…
          </p>
        ) : meetings.kind === 'failed' ? (
          <p className="load-error" role="alert">
            Stretnutia sa nepodarilo načítať.
          </p>
        ) : recorded.length === 0 ? (
          <p className="empty">Zatiaľ nemáte žiadne nahrané stretnutia. Po zastavení nahrávania sa tu zobrazí aj s prepisom.</p>
        ) : (
          <ol className="history-list meeting-list" aria-label="Nahrané stretnutia">
            {recorded.map((meeting) => (
              <li key={meeting.id}>
                <button type="button" className="meeting-pick" aria-current={meeting.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(meeting.id)}>
                  <span>{meeting.title}</span>
                  <span className="meeting-meta">
                    {formatClock(meeting.durationMs)} · {phaseLabel(meeting.phase)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      {selected !== null && <MeetingDetail key={selected.id} summary={selected} />}
    </div>
  );
}
