import type { AppStatus } from '../../shared/app-status';
import { bannerContent } from '../home/banner-content';
import type { Live } from '../home/live-value';
import { CheckIcon, PauseIcon, WarnIcon } from './Icons';

type StatusBannerProps = { status: Live<AppStatus>; onOpenSettings: () => void };

export function StatusBanner({ status, onOpenSettings }: StatusBannerProps) {
  if (status.kind === 'loading') {
    return null;
  }
  if (status.kind === 'failed') {
    return (
      <div className="banner" role="status">
        <span className="orb warn">
          <WarnIcon />
        </span>
        <span>Stav aplikácie sa nepodarilo zistiť.</span>
      </div>
    );
  }
  const content = bannerContent(status.value);
  if (content.kind === 'ready') {
    return (
      <div className="banner" role="status">
        <span className="orb done">
          <CheckIcon />
        </span>
        <span>
          Všetko je pripravené. Podržte <kbd>{content.hotkeyLabel}</kbd> v ľubovoľnej aplikácii a hovorte.
        </span>
      </div>
    );
  }
  if (content.kind === 'paused') {
    return (
      <div className="banner" role="status">
        <span className="orb mute">
          <PauseIcon />
        </span>
        <span>Diktovanie je pozastavené. Obnovíte ho položkou Pokračovať v menu na lište.</span>
      </div>
    );
  }
  return (
    <div className="banner action" role="status">
      <span className="orb warn">
        <WarnIcon />
      </span>
      <span>{content.message}</span>
      <button type="button" className="btn primary" onClick={onOpenSettings}>
        Otvoriť nastavenia
      </button>
    </div>
  );
}
