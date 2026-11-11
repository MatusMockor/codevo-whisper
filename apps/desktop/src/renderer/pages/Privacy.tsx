import type { NavTarget } from '../navigation';
import { ZONES } from '../privacy/privacy-copy';
import { StorageCard } from '../privacy/StorageCard';
import { usePrivacyZones } from '../privacy/use-privacy-zones';
import { VoiceCard } from '../privacy/VoiceCard';
import { Zone } from '../privacy/Zone';

export function Privacy({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const zones = usePrivacyZones();
  return (
    <div className="page privacy">
      <div className="zones">
        {ZONES.map((copy) => (
          <Zone key={copy.id} copy={copy} state={zones[copy.id]} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="priv-cols">
        <VoiceCard />
        <StorageCard onNavigate={onNavigate} />
      </div>
    </div>
  );
}
