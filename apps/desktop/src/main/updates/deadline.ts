export function withDeadline<T>(work: Promise<T>, timeoutMs: number, message: string, onTimeout: () => void = () => undefined): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
