import { isMeetingId } from '../../shared/meetings';
import type { MeetingRecorder } from '../meetings/meeting-recorder';
import type { MeetingStore } from '../meetings/meeting-store';
import type { MeetingTranscriber } from '../meetings/meeting-transcriber';
import type { Diarizer } from '../models/diarizer';
import type { HandlerGroup } from './invoke-handlers';
import { IpcValidationError, rejectArguments } from './validate';
import { withoutArguments } from './without-arguments';

export type MeetingHandlerDeps = {
  meetings: {
    store: Pick<MeetingStore, 'list' | 'get' | 'meeting' | 'delete'>;
    recorder: Pick<MeetingRecorder, 'start' | 'stop'>;
    transcriber: Pick<MeetingTranscriber, 'transcribe'>;
    diarizer: Pick<Diarizer, 'view' | 'download' | 'pause' | 'delete'>;
    modelReady: () => boolean;
  };
};

const NO_MODEL = 'Stretnutia sa prepisujú lokálnym modelom. Najprv ho stiahnite v Nastaveniach.';

function meetingId(id: unknown, extra: readonly unknown[]): string {
  rejectArguments(extra);
  if (!isMeetingId(id)) throw new IpcValidationError('Invalid meeting id');
  return id;
}

export function meetingHandlers({ meetings }: MeetingHandlerDeps): HandlerGroup<
  'getMeetings' | 'getMeeting' | 'startMeeting' | 'stopMeeting' | 'retranscribeMeeting' | 'deleteMeeting' | 'getDiarizer' | 'downloadDiarizer' | 'pauseDiarizer' | 'deleteDiarizer'
> {
  const { store, recorder, transcriber, diarizer } = meetings;
  return {
    getMeetings: withoutArguments(() => store.list()),
    getMeeting: async (id, ...extra) => store.meeting(meetingId(id, extra)),
    startMeeting: withoutArguments(() => {
      if (!meetings.modelReady()) throw new Error(NO_MODEL);
      return recorder.start();
    }),
    stopMeeting: withoutArguments(async () => {
      const id = await recorder.stop();
      if (id !== null) void transcriber.transcribe(id);
    }),
    retranscribeMeeting: (id, ...extra) =>
      new Promise<void>((resolve) => {
        void transcriber.transcribe(meetingId(id, extra));
        resolve();
      }),
    deleteMeeting: async (id, ...extra) => {
      const valid = meetingId(id, extra);
      const phase = store.get(valid)?.phase.kind;
      if (phase === 'recording' || phase === 'transcribing') throw new Error('Stretnutie sa nedá zmazať počas nahrávania alebo prepisu.');
      await store.delete(valid);
    },
    getDiarizer: withoutArguments(() => diarizer.view()),
    downloadDiarizer: withoutArguments(() => diarizer.download()),
    pauseDiarizer: withoutArguments(() => diarizer.pause()),
    deleteDiarizer: withoutArguments(() => diarizer.delete()),
  };
}
