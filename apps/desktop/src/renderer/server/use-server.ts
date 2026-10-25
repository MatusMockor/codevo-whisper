import { useLiveValue, type Live } from '../home/live-value';
import type { ServerView } from '../../shared/server';

const loadServer = () => window.codevo.getServer();

export function useServer(): Live<ServerView> {
  return useLiveValue('server-changed', loadServer);
}
