export type TranscriptEvent = {
  type: 'partial' | 'final';
  segmentId: number;
  revision: number;
  text: string;
};
