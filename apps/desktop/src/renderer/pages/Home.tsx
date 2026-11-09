import { HistoryPanel } from '../components/HistoryPanel';
import { LastTranscriptCard } from '../components/LastTranscriptCard';
import { SignalPathCard } from '../home/SignalPathCard';
import { StatsCard } from '../home/StatsCard';
import type { Dictation } from '../home/use-dictation';
import { useLastTranscript } from '../home/use-last-transcript';
import type { NavTarget } from '../navigation';

type HomeProps = { dictation: Dictation; onNavigate: (target: NavTarget) => void };

export function Home({ dictation, onNavigate }: HomeProps) {
  const lastTranscript = useLastTranscript();

  return (
    <div className="home">
      <SignalPathCard dictation={dictation} onNavigate={onNavigate} />
      <StatsCard />
      <div className="home-duo">
        <LastTranscriptCard transcript={lastTranscript} />
        <HistoryPanel />
      </div>
    </div>
  );
}
