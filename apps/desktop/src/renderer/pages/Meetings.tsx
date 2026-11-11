import { useState } from 'react';
import type { MeetingSummary } from '../../shared/meetings';
import type { Live } from '../home/live-value';
import { MeetingDetail } from '../meetings/MeetingDetail';
import { MeetingList } from '../meetings/MeetingList';
import { MeetingsEmpty } from '../meetings/MeetingsEmpty';
import { RecordCard } from '../meetings/RecordCard';
import { SpeakersCard } from '../meetings/SpeakersCard';
import { useLocalModelReady, useMeetings } from '../meetings/use-meetings';
import type { NavTarget } from '../navigation';

type MeetingsProps = { onNavigate: (target: NavTarget) => void };

type MainProps = { meetings: Live<MeetingSummary[]>; selected: MeetingSummary | null; modelReady: boolean | null; onNavigate: (target: NavTarget) => void };

function MeetingsMain({ meetings, selected, modelReady, onNavigate }: MainProps) {
  if (meetings.kind === 'loading') {
    return (
      <p className="last empty" role="status">
        Načítavajú sa stretnutia…
      </p>
    );
  }
  if (meetings.kind === 'failed') {
    return (
      <p className="last load-error" role="alert">
        Stretnutia sa nepodarilo načítať.
      </p>
    );
  }
  if (selected === null) {
    return <MeetingsEmpty modelReady={modelReady} onNavigate={onNavigate} />;
  }
  return <MeetingDetail key={selected.id} summary={selected} onNavigate={onNavigate} />;
}

export function Meetings({ onNavigate }: MeetingsProps) {
  const meetings = useMeetings();
  const modelReady = useLocalModelReady();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = meetings.kind === 'ready' ? meetings.value : [];
  const recording = list.find((meeting) => meeting.phase.kind === 'recording') ?? null;
  const recorded = list.filter((meeting) => meeting.phase.kind !== 'recording');
  const selected = recorded.find((meeting) => meeting.id === selectedId) ?? recorded[0] ?? null;

  return (
    <div className="page meetings">
      <div className="meet-grid">
        <div className="meet-side">
          <RecordCard recording={recording} modelReady={modelReady} onNavigate={onNavigate} />
          {recorded.length > 0 && <MeetingList meetings={recorded} selectedId={selected?.id ?? null} onSelect={setSelectedId} />}
          <SpeakersCard />
        </div>
        <div className="meet-main">
          <MeetingsMain meetings={meetings} selected={selected} modelReady={modelReady} onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}
