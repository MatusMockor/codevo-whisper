export type Opened<T> = { value: T; fallback: boolean };

const VANISHED_DEVICE_ERRORS: ReadonlySet<string> = new Set(['OverconstrainedError', 'NotFoundError']);

function isVanishedDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' && VANISHED_DEVICE_ERRORS.has(error.name);
}

export async function openWithFallback<T>(open: (deviceId: string | null) => Promise<T>, deviceId: string | null): Promise<Opened<T>> {
  try {
    return { value: await open(deviceId), fallback: false };
  } catch (error) {
    if (deviceId === null || !isVanishedDevice(error)) {
      throw error;
    }
    return { value: await open(null), fallback: true };
  }
}
