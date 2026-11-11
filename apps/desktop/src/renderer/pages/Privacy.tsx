import type { NavTarget } from '../navigation';
import { ZONES } from '../privacy/privacy-copy';
import { StorageCard } from '../privacy/StorageCard';
import { usePrivacyView } from '../privacy/use-privacy-view';
import { VoiceCard } from '../privacy/VoiceCard';
import { Zone } from '../privacy/Zone';

export function Privacy({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const { zones, route } = usePrivacyView();
  return (
    <div className="page privacy">
      <div className="zones">
        {ZONES.map((copy) => (
          <Zone key={copy.id} copy={copy} state={zones[copy.id]} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="priv-cols">
        <VoiceCard route={route} />
        <StorageCard onNavigate={onNavigate} />
      </div>
    </div>
  );
}
