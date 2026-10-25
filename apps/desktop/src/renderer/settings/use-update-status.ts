import { useLiveValue, type Live } from '../home/live-value';
import type { UpdateStatus } from '../../shared/updates';

const loadStatus = () => window.codevo.getUpdateStatus();

export function useUpdateStatus(): Live<UpdateStatus> {
  return useLiveValue('update-status-changed', loadStatus);
}
