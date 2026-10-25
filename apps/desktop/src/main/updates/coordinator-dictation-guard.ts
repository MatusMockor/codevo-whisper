import type { SessionCoordinator } from '../session/session-coordinator';
import type { DictationGuard } from './dictation-guard';

export type GuardedCoordinator = Pick<SessionCoordinator, 'isDictating' | 'isPaused' | 'pause' | 'resume'>;

export function coordinatorDictationGuard(coordinator: () => GuardedCoordinator): DictationGuard {
  return {
    isDictating: () => coordinator().isDictating(),
    suspend: () => {
      const target = coordinator();
      if (target.isPaused()) {
        return () => undefined;
      }
      target.pause();
      return () => target.resume();
    },
  };
}
