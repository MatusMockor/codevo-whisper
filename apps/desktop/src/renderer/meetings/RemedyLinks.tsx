import type { NavTarget } from '../navigation';
import type { MeetingRemedy } from './meeting-remedies';

type RemedyLinksProps = { remedies: readonly MeetingRemedy[]; onNavigate: (target: NavTarget) => void };

export function RemedyLinks({ remedies, onNavigate }: RemedyLinksProps) {
  if (remedies.length === 0) {
    return null;
  }
  return (
    <span className="remedies">
      {remedies.map((remedy) => (
        <button key={remedy.id} type="button" className="linkbtn" onClick={() => onNavigate(remedy.target)}>
          {remedy.label}
        </button>
      ))}
    </span>
  );
}
