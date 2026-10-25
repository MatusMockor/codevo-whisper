export function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64url(text: string, expectedBytes: number, label: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'));
  if (bytes.length !== expectedBytes || toBase64url(bytes) !== text) {
    throw new Error(`${label} must be ${expectedBytes} bytes of base64url`);
  }
  return bytes;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
