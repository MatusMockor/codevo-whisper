import type { AppStatus } from '../../shared/app-status';
import { bannerContent, type ActionContent } from '../home/banner-content';
import type { EngineIssue } from '../home/engine-issue';
import type { NowTone } from './now-state';

export type ReadinessNote = { message: string; content: ActionContent | null };

export const PAUSED_NOTE = 'Prepis je pripravený, diktovanie je však pozastavené. Obnovíte ho položkou Pokračovať v menu na lište.';

export function readinessNote(status: AppStatus | null, issue: EngineIssue | null, tone: NowTone): ReadinessNote | null {
  if (status === null || tone === 'err') {
    return null;
  }
  const content = bannerContent(status, issue);
  if (content.kind === 'paused') {
    return { message: PAUSED_NOTE, content: null };
  }
  if (content.kind === 'ready' || content.target.page === 'transcription') {
    return null;
  }
  return { message: `Prepis je pripravený, diktovanie však zatiaľ nefunguje. ${content.message}`, content };
}
