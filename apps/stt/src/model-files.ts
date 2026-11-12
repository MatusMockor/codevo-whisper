import { access } from 'node:fs/promises';

async function isPresent(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export async function missingFiles(paths: readonly string[]): Promise<string[]> {
  const present = await Promise.all(paths.map(isPresent));
  return paths.filter((_path, index) => present[index] !== true);
}
