export type Reply = Record<string, unknown>;

export function asReply(value: unknown): Reply {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as Reply;
}

export function text(reply: Reply, key: string): string {
  const value = reply[key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '-';
}
