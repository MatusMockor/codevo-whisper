import { expect, it, vi } from 'vitest';
import { meetingHandlers } from '../src/main/ipc/meeting-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import type { MeetingRecord } from '../src/main/meetings/meeting-store';

const ID = '20261107-090503-abcdef';

function handlers(phase: MeetingRecord['phase'] = { kind: 'ready' }, modelReady = true) {
  const store = {
    list: () => [],
    get: (id: string) => (id === ID ? ({ id, phase } as MeetingRecord) : null),
    meeting: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const recorder = { start: vi.fn(() => Promise.reject(new Error('unused'))), stop: vi.fn(() => Promise.resolve(ID)) };
  const transcriber = { transcribe: vi.fn(() => Promise.resolve()) };
  return { store, recorder, transcriber, api: meetingHandlers({ meetings: { store, recorder, transcriber, modelReady: () => modelReady } }) };
}

it('rejects meeting ids that could leave the meetings directory', async () => {
  const { api, store } = handlers();
  for (const id of ['../settings', '20261107-090503-abcdef/..', '', 42, null]) {
    await expect(api.getMeeting(id)).rejects.toThrow(IpcValidationError);
    await expect(api.deleteMeeting(id)).rejects.toThrow(IpcValidationError);
    await expect(api.retranscribeMeeting(id)).rejects.toThrow(IpcValidationError);
  }
  expect(store.meeting).not.toHaveBeenCalled();
  expect(store.delete).not.toHaveBeenCalled();
});

it('refuses to record without a downloaded local model', async () => {
  const { api, recorder } = handlers(undefined, false);

  await expect(api.startMeeting()).rejects.toThrow('Najprv ho stiahnite v Nastaveniach.');
  expect(recorder.start).not.toHaveBeenCalled();
});

it('transcribes a meeting right after it stops', async () => {
  const { api, transcriber } = handlers();

  await api.stopMeeting();

  expect(transcriber.transcribe).toHaveBeenCalledWith(ID);
});

it('keeps a meeting that is still recording or transcribing', async () => {
  for (const phase of [{ kind: 'recording' }, { kind: 'transcribing', step: 'mic' }] as const) {
    const { api, store } = handlers(phase);
    await expect(api.deleteMeeting(ID)).rejects.toThrow('Stretnutie sa nedá zmazať');
    expect(store.delete).not.toHaveBeenCalled();
  }
  const { api, store } = handlers({ kind: 'ready' });
  await api.deleteMeeting(ID);
  expect(store.delete).toHaveBeenCalledWith(ID);
});
