import { useEffect, useState } from 'react';
import { isAiConfigured, type AiProvider } from '../../shared/ai';
import type { Meeting, MeetingSummary } from '../../shared/meetings';
import type { DiarizerView } from '../../shared/models';
import { useLiveValue, type Live } from '../home/live-value';
import { useSettings } from '../settings/use-settings';

const loadMeetings = () => window.codevo.getMeetings();
const loadModelStates = () => window.codevo.getModelStates();
const loadDiarizer = () => window.codevo.getDiarizer();

export type NotesProvider = AiProvider | 'none';

export function useMeetings(): Live<MeetingSummary[]> {
  return useLiveValue('meetings-changed', loadMeetings);
}

export function useDiarizer(): Live<DiarizerView> {
  return useLiveValue('diarizer-changed', loadDiarizer);
}

export function useNotesProvider(): NotesProvider | null {
  const settings = useSettings();
  if (settings.kind === 'loading') return null;
  if (settings.kind === 'failed') return 'none';
  return isAiConfigured(settings.value) ? settings.value.aiProvider : 'none';
}

export function useLocalModelReady(): boolean | null {
  const settings = useSettings();
  const states = useLiveValue('model-states-changed', loadModelStates);
  if (settings.kind === 'loading' || states.kind === 'loading') return null;
  if (settings.kind === 'failed' || states.kind === 'failed') return false;
  return states.value.some((state) => state.id === settings.value.localModelId && state.status === 'ready');
}

export function useMeeting(summary: MeetingSummary): Live<Meeting | null> {
  const [meeting, setMeeting] = useState<Live<Meeting | null>>({ kind: 'loading' });
  const { id } = summary;
  const revision = JSON.stringify([summary.phase, summary.notesPending, summary.notesError]);

  useEffect(() => {
    let active = true;
    window.codevo.getMeeting(id).then(
      (value) => {
        if (active) setMeeting({ kind: 'ready', value });
      },
      (error: unknown) => {
        console.error('Loading the meeting failed', error);
        if (active) setMeeting({ kind: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [id, revision]);

  return meeting;
}

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  return now;
}
