import type { ReactNode } from 'react';
import type { OverlayAction } from '../../shared/overlay-contract';
import type { MessageButton } from './overlay-copy';
import { CopyIcon, DownIcon } from './OverlayIcons';

export type CardTone = 'err' | 'amber' | 'done';

type OverlayCardProps = {
  tone: CardTone;
  icon: ReactNode;
  title: string;
  detail: string | null;
  buttons: readonly MessageButton[];
  onAction: (action: OverlayAction) => void;
};

const BUTTON_ICONS: Partial<Readonly<Record<OverlayAction, () => ReactNode>>> = Object.freeze({
  'copy-last': () => <CopyIcon />,
  'download-model': () => <DownIcon />,
});

function ActionButton({ button, onAction }: { button: MessageButton; onAction: (action: OverlayAction) => void }) {
  const icon = BUTTON_ICONS[button.action];
  return (
    <button type="button" className={button.primary ? 'ov-btn primary' : 'ov-btn'} onClick={() => onAction(button.action)}>
      {icon?.()}
      {button.label}
    </button>
  );
}

export function OverlayCard({ tone, icon, title, detail, buttons, onAction }: OverlayCardProps) {
  return (
    <div className={`ov card ${tone}`} role={tone === 'done' ? 'status' : 'alert'}>
      <div className="ov-msg">
        <span className={`orb ${tone}`}>{icon}</span>
        <div className="ov-copy">
          <p className="ov-title">{title}</p>
          {detail !== null && <p className="ov-sub">{detail}</p>}
        </div>
      </div>
      {buttons.length > 0 && (
        <div className="ov-actions">
          {buttons.map((button) => (
            <ActionButton key={button.action} button={button} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}
