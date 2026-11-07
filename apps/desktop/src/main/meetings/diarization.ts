import type { SpeakerSegment } from '../../shared/meetings';

const SEGMENTS_HEADER = /^speaker segments: \d+$/;
const SEGMENT_LINE = /^\s*\[\s*(\d+\.\d+)\s*->\s*(\d+\.\d+)\]\s*S(\d+)\s*$/;

function toMs(seconds: string): number {
  return Math.round(Number(seconds) * 1000);
}

export function parseDiarization(stdout: string): SpeakerSegment[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => SEGMENTS_HEADER.test(line.trim()));
  if (start === -1) {
    return [];
  }
  const segments: SpeakerSegment[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = SEGMENT_LINE.exec(line);
    if (match === null) {
      break;
    }
    segments.push({ t0Ms: toMs(match[1] ?? '0'), t1Ms: toMs(match[2] ?? '0'), speaker: Number(match[3]) });
  }
  return segments.sort((a, b) => a.t0Ms - b.t0Ms);
}
