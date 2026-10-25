const HEADER_BYTES = 12;

type Chunk = { id: string; offset: number; size: number };

function ascii(view: DataView, offset: number): string {
  return String.fromCharCode(...[0, 1, 2, 3].map((index) => view.getUint8(offset + index)));
}

function chunks(view: DataView): Chunk[] {
  const found: Chunk[] = [];
  for (let offset = HEADER_BYTES; offset + 8 <= view.byteLength; ) {
    const size = view.getUint32(offset + 4, true);
    found.push({ id: ascii(view, offset), offset: offset + 8, size });
    offset += 8 + size + (size % 2);
  }
  return found;
}

function assertFormat(view: DataView, fmt: Chunk | undefined): void {
  if (fmt === undefined || fmt.size < 16 || view.getUint16(fmt.offset, true) !== 1) {
    throw new Error('expected an uncompressed PCM WAV file');
  }
  if (view.getUint16(fmt.offset + 2, true) !== 1) {
    throw new Error('expected mono audio');
  }
  if (view.getUint32(fmt.offset + 4, true) !== 16000) {
    throw new Error('expected 16 kHz audio');
  }
  if (view.getUint16(fmt.offset + 14, true) !== 16) {
    throw new Error('expected 16 bit samples');
  }
}

export function readPcmFromWav(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_BYTES || ascii(view, 0) !== 'RIFF' || ascii(view, 8) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  const found = chunks(view);
  assertFormat(view, found.find((chunk) => chunk.id === 'fmt '));
  const data = found.find((chunk) => chunk.id === 'data');
  if (data === undefined) {
    throw new Error('the WAV file has no data chunk');
  }
  const available = Math.min(data.size, bytes.length - data.offset);
  return bytes.slice(data.offset, data.offset + available - (available % 2));
}
