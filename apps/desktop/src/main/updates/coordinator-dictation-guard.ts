import { settleWithin, type SettlingWork } from '../app/quit-gate';
import type { Logger } from '../logging/logger';
import type { SessionCoordinator } from '../session/session-coordinator';
import type { DictationGuard } from './dictation-guard';

export type GuardedCoordinator = Pick<SessionCoordinator, 'isDictating' | 'isPaused' | 'pause' | 'resume' | 'settled'>;

export type BlockableMicrophone = SettlingWork & { block(): () => void };

export type InstallGuardDeps = {
  coordinator: () => GuardedCoordinator;
  microphone: BlockableMicrophone;
  meter: { stopMeter(): Promise<void> };
  logger: Logger;
  settleMs?: number;
};

const SETTLE_MS = 2000;

function pauseDictation(coordinator: GuardedCoordinator): () => void {
  if (coordinator.isPaused()) {
    return () => undefined;
  }
  coordinator.pause();
  return () => coordinator.resume();
}

export function coordinatorDictationGuard({ coordinator, microphone, meter, logger, settleMs = SETTLE_MS }: InstallGuardDeps): DictationGuard {
  return {
    isDictating: () => coordinator().isDictating(),
    suspend: async () => {
      const resume = pauseDictation(coordinator());
      const unblock = microphone.block();
      await meter.stopMeter().catch((error: unknown) => {
        logger.warn('The microphone meter could not be stopped before the update', error);
      });
      if (!(await settleWithin({ isBusy: () => microphone.isBusy(), settled: async () => {
        await coordinator().settled();
        await microphone.settled();
      } }, settleMs))) {
        logger.warn('Installing the update while the microphone is still busy', { settleMs });
      }
      return () => {
        unblock();
        resume();
      };
    },
  };
}
