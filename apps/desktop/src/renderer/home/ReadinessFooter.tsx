import type { ReactNode } from 'react';
import type { AppStatus } from '../../shared/app-status';
import { Led } from '../components/Led';
import type { NavTarget } from '../navigation';
import { preferEngine } from '../settings/prefer-engine';
import { bannerContent } from './banner-content';
import type { EngineIssue } from './engine-issue';
import type { Live } from './live-value';
import { readinessActions, type ReadinessCommand } from './readiness-actions';
import type { SignalState } from './transcription-route';

type FooterProps = { tone: SignalState; title: string; children?: ReactNode; aside?: ReactNode };

function Footer({ tone, title, children, aside }: FooterProps) {
  return (
    <div className={`banner sp-foot ${tone}`} role="status">
      <Led state={tone} large />
      <p className="msg">
        <b>{title}</b>
        {children !== undefined && (
          <>
            {' '}
            <span>{children}</span>
          </>
        )}
      </p>
      {aside}
    </div>
  );
}

type Navigate = (target: NavTarget) => void;

function run(command: ReadinessCommand, onNavigate: Navigate): void {
  if (command.kind === 'prefer-engine') {
    preferEngine(command.engine);
    return;
  }
  onNavigate(command.target);
}

type ReadinessFooterProps = { status: Live<AppStatus>; issue: EngineIssue | null; onNavigate: Navigate };

export function ReadinessFooter({ status, issue, onNavigate }: ReadinessFooterProps) {
  if (status.kind === 'loading') {
    return null;
  }
  if (status.kind === 'failed') {
    return <Footer tone="err" title="Stav aplikácie sa nepodarilo zistiť." />;
  }
  const content = bannerContent(status.value, issue);
  if (content.kind === 'ready') {
    return (
      <Footer tone="ok" title="Všetko je pripravené." aside={<span className="label-mono">4/4 pripravené</span>}>
        {content.verb} <kbd>{content.hotkeyLabel}</kbd> v ľubovoľnej aplikácii a hovorte.
      </Footer>
    );
  }
  if (content.kind === 'paused') {
    return (
      <Footer tone="off" title="Diktovanie je pozastavené.">
        Obnovíte ho položkou Pokračovať v menu na lište.
      </Footer>
    );
  }
  const actions = (
    <div className="row-btns">
      {readinessActions(content).map((action) => (
        <button key={action.id} type="button" className={action.primary ? 'btn primary' : 'btn'} onClick={() => run(action.command, onNavigate)}>
          {action.label}
        </button>
      ))}
    </div>
  );
  return (
    <Footer tone="err" title="Diktovanie by teraz zlyhalo." aside={actions}>
      {content.message}
    </Footer>
  );
}
