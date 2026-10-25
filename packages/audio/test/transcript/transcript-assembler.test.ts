import { describe, expect, it } from 'vitest';
import { msToSamples } from '../../src/pcm/pcm-format';
import type { CutReason, Segment } from '../../src/segmentation/segment';
import { TranscriptAssembler } from '../../src/transcript/transcript-assembler';

function segment(id: number, leadInMs = 0, reason: CutReason = 'pause'): Segment {
  return { id, startSample: 0, endSample: 1, leadInSamples: msToSamples(leadInMs), reason, voiced: true };
}

describe('TranscriptAssembler', () => {
  it('revisions increase per segment and restart for the next segment', () => {
    const assembler = new TranscriptAssembler();

    expect([assembler.nextPartialRevision(0), assembler.nextPartialRevision(0), assembler.nextPartialRevision(1)]).toEqual([1, 2, 1]);
  });

  it('the final revision is above every partial revision', () => {
    const assembler = new TranscriptAssembler();
    assembler.nextPartialRevision(0);
    assembler.nextPartialRevision(0);

    expect(assembler.commit(segment(0))).toBe(3);
    expect(assembler.acceptFinal(0, 'hotovo')).toEqual([{ type: 'final', segmentId: 0, revision: 3, text: 'hotovo' }]);
  });

  it('emits a partial and drops one older than the last emitted', () => {
    const assembler = new TranscriptAssembler();
    const first = assembler.nextPartialRevision(0);
    const second = assembler.nextPartialRevision(0);

    expect(assembler.acceptPartial(0, second, 'dobrý deň', 0)).toEqual({ type: 'partial', segmentId: 0, revision: 2, text: 'dobrý deň' });
    expect(assembler.acceptPartial(0, first, 'dobrý', 0)).toBeUndefined();
  });

  it('ignores a partial that arrives after its segment was committed', () => {
    const assembler = new TranscriptAssembler();
    const revision = assembler.nextPartialRevision(0);
    assembler.commit(segment(0));

    expect(assembler.acceptPartial(0, revision, 'neskoro', 0)).toBeUndefined();
  });

  it('releases finals in segment order', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1));

    expect(assembler.acceptFinal(1, 'druhý')).toEqual([]);
    expect(assembler.pendingFinals).toBe(2);
    expect(assembler.acceptFinal(0, 'prvý').map((event) => event.segmentId)).toEqual([0, 1]);
    expect(assembler.pendingFinals).toBe(0);
  });

  it('dedups a final against the previous final using the lead-in', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1, 1000));
    assembler.acceptFinal(0, 'Ak to neprejde, potom to zahodíme.');

    expect(assembler.acceptFinal(1, 'zahodím. Potom spravíme nový.')[0]?.text).toBe('Potom spravíme nový.');
  });

  it('does not dedup a segment without lead-in', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1));
    assembler.acceptFinal(0, 'to je');

    expect(assembler.acceptFinal(1, 'je to tak')[0]?.text).toBe('je to tak');
  });

  it('dedups a partial against the released previous final', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.acceptFinal(0, 'a potom to zahodíme.');
    const revision = assembler.nextPartialRevision(1);

    expect(assembler.acceptPartial(1, revision, 'zahodím. Potom', msToSamples(500))?.text).toBe('Potom');
  });

  it('dedups against the last non-empty final when a segment was empty', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1, 500));
    assembler.commit(segment(2, 1000));
    assembler.acceptFinal(0, 'koniec vety');
    assembler.acceptFinal(1, '');

    expect(assembler.acceptFinal(2, 'vety a ďalej')[0]?.text).toBe('a ďalej');
  });

  it('skipFinal emits an empty final and unblocks later finals', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1));
    assembler.acceptFinal(1, 'druhý');

    expect(assembler.skipFinal(0)).toEqual([
      { type: 'final', segmentId: 0, revision: 1, text: '' },
      { type: 'final', segmentId: 1, revision: 1, text: 'druhý' },
    ]);
  });

  it('removes a five-word overlap with a 1 s lead-in by default', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0));
    assembler.commit(segment(1, 1000));
    assembler.acceptFinal(0, 'a teraz raz dva tri štyri päť');

    expect(assembler.acceptFinal(1, 'raz dva tri štyri päť šesť')[0]?.text).toBe('šesť');
  });

  it('withholds the last word of a hard-cut final until the next final', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0, 0, 'hard'));
    assembler.commit(segment(1, 1000, 'end'));

    expect(assembler.acceptFinal(0, 'a potom pokrač')[0]?.text).toBe('a potom');
    expect(assembler.acceptFinal(1, 'potom pokračujeme ďalej')[0]?.text).toBe('pokračujeme ďalej');
    expect(assembler.text()).toBe('a potom pokračujeme ďalej');
  });

  it('emits the withheld word when the segment after a hard cut fails', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0, 0, 'hard'));
    assembler.commit(segment(1, 1000, 'end'));
    assembler.acceptFinal(0, 'a potom koniec');

    expect(assembler.skipFinal(1)[0]?.text).toBe('koniec');
    expect(assembler.text()).toBe('a potom koniec');
  });

  it('a partial after a hard cut resolves against the withheld word', () => {
    const assembler = new TranscriptAssembler();
    assembler.commit(segment(0, 0, 'hard'));
    assembler.acceptFinal(0, 'a potom pokrač');
    const revision = assembler.nextPartialRevision(1);

    expect(assembler.acceptPartial(1, revision, 'potom pokračujeme', msToSamples(1000))?.text).toBe('pokračujeme');
  });

  it('text joins the non-empty finals', () => {
    const assembler = new TranscriptAssembler();
    [0, 1, 2].forEach((id) => assembler.commit(segment(id)));
    assembler.acceptFinal(0, 'Prvá veta.');
    assembler.acceptFinal(1, '  ');
    assembler.acceptFinal(2, 'Druhá veta.');

    expect(assembler.text()).toBe('Prvá veta. Druhá veta.');
  });
});
