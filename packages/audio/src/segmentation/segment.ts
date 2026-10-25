export type CutReason = 'pause' | 'hard' | 'end';

export type Segment = {
  id: number;
  startSample: number;
  endSample: number;
  leadInSamples: number;
  reason: CutReason;
  voiced: boolean;
};
