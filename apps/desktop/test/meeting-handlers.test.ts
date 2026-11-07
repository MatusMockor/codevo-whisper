import { expect, it, vi } from 'vitest';
import { meetingHandlers } from '../src/main/ipc/meeting-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import type { MeetingRecord } from '../src/main/meetings/meeting-store';

const ID = '20261107-090503-abcdef';

function handlers(phase: MeetingRecord['phase'] = { kind: 'ready' }, modelReady = true, notesPending = false, busy: { transcribing?: boolean; generating?: boolean } = {}) {
  const store = {
    list: () => [],
    get: (id: string) => (id === ID ? ({ id, phase, notesPending } as MeetingRecord) : null),
    meeting: vi.fn(() => Promise.resolve(null)),
    delete: vi.fn(() => Promise.resolve()),
  };
  const recorder = { start: vi.fn(() => Promise.reject(new Error('unused'))), stop: vi.fn(() => Promise.resolve(ID)) };
  const transcriber = { transcribe: vi.fn(() => Promise.resolve()), isTranscribing: (id: string) => id === ID && busy.transcribing === true };
  const diarizer = { view: vi.fn(), download: vi.fn(() => Promise.resolve()), pause: vi.fn(), delete: vi.fn(() => Promise.resolve()) };
  const notes = { generate: vi.fn(() => Promise.resolve()), isGenerating: (id: string) => id === ID && busy.generating === true };
  const exportMeeting = vi.fn(() => Promise.resolve(true));
  return { store, recorder, transcriber, diarizer, notes, exportMeeting, api: meetingHandlers({ meetings: { store, recorder, transcriber, diarizer, notes, exportMeeting, modelReady: () => modelReady } }) };
}

it('rejects meeting ids that could leave the meetings directory', async () => {
  const { api, store, notes, exportMeeting } = handlers();
  for (const id of ['../settings', '20261107-090503-abcdef/..', '', 42, null]) {
    await expect(api.getMeeting(id)).rejects.toThrow(IpcValidationError);
    await expect(api.deleteMeeting(id)).rejects.toThrow(IpcValidationError);
    await expect(api.retranscribeMeeting(id)).rejects.toThrow(IpcValidationError);
    await expect(api.generateMeetingNotes(id)).rejects.toThrow(IpcValidationError);
    await expect(api.exportMeeting(id)).rejects.toThrow(IpcValidationError);
  }
  expect(store.meeting).not.toHaveBeenCalled();
  expect(store.delete).not.toHaveBeenCalled();
  expect(notes.generate).not.toHaveBeenCalled();
  expect(exportMeeting).not.toHaveBeenCalled();
});

it('starts notes and exports a meeting only for a valid id and no extra arguments', async () => {
  const { api, notes, exportMeeting } = handlers();

  await expect(api.exportMeeting(ID, '/tmp/elsewhere.md')).rejects.toThrow(IpcValidationError);
  await api.generateMeetingNotes(ID);
  await expect(api.exportMeeting(ID)).resolves.toBe(true);

  expect(notes.generate).toHaveBeenCalledWith(ID);
  expect(exportMeeting).toHaveBeenCalledExactlyOnceWith(ID);
});

it('keeps a meeting while its notes are generated', async () => {
  const { api, store } = handlers({ kind: 'ready' }, true, true);

  await expect(api.deleteMeeting(ID)).rejects.toThrow('Stretnutie sa nedá zmazať');
  expect(store.delete).not.toHaveBeenCalled();
});

it('refuses notes while the meeting waits for or runs a new transcription', async () => {
  const { api, notes } = handlers({ kind: 'ready' }, true, false, { transcribing: true });

  await expect(api.generateMeetingNotes(ID)).rejects.toThrow('Poznámky sa nedajú vytvoriť počas prepisu.');
  expect(notes.generate).not.toHaveBeenCalled();
});

it('refuses a new transcription while the notes are generated', async () => {
  const { api, transcriber } = handlers({ kind: 'ready' }, true, false, { generating: true });

  await expect(api.retranscribeMeeting(ID)).rejects.toThrow('Stretnutie sa nedá prepísať počas vytvárania poznámok.');
  expect(transcriber.transcribe).not.toHaveBeenCalled();
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

it('downloads the diarizer only on a call without arguments', async () => {
  const { api, diarizer } = handlers();

  await expect(api.downloadDiarizer('../other-model')).rejects.toThrow(IpcValidationError);
  expect(diarizer.download).not.toHaveBeenCalled();
  await api.downloadDiarizer();
  expect(diarizer.download).toHaveBeenCalledOnce();
});
