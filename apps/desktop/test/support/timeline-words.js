export const BLOCK_SAMPLES = 4800;
export const KEY_SAMPLES = 16;

const LETTERS = 'bcdfghjklmnprstvzaeiou';
const VOICED_RMS = 300;

export function wordFor(block) {
  let state = (block + 1) * 2654435761;
  let word = '';
  for (let index = 0; index < 8; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    word += LETTERS[state % LETTERS.length];
  }
  return word;
}

function isVoiced(source, block) {
  const start = block * BLOCK_SAMPLES;
  const end = Math.min(source.length, start + BLOCK_SAMPLES);
  let energy = 0;
  for (let index = start; index < end; index += 1) {
    energy += source[index] * source[index];
  }
  return end > start && Math.sqrt(energy / (end - start)) >= VOICED_RMS;
}

export function timelineWords(source, from, to) {
  const words = [];
  const end = Math.min(to, source.length);
  for (let block = Math.max(0, Math.ceil(from / BLOCK_SAMPLES - 0.5)); (block + 0.5) * BLOCK_SAMPLES < end; block += 1) {
    if (isVoiced(source, block)) {
      words.push(wordFor(block));
    }
  }
  return words;
}

function matchesAt(source, job, offset) {
  for (let index = 0; index < KEY_SAMPLES; index += 1) {
    if (source[offset + index] !== job[index]) {
      return false;
    }
  }
  return true;
}

export function locateJob(source, job) {
  const found = [];
  for (let offset = 0; offset + KEY_SAMPLES <= source.length && found.length < 2; offset += 1) {
    if (matchesAt(source, job, offset)) {
      found.push(offset);
    }
  }
  return found.length === 1 ? found[0] : -1;
}
