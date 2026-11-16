export class ModelInventory {
  private readonly installed: Set<string>;

  constructor(installed: Iterable<string> = []) {
    this.installed = new Set(installed);
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  markInstalled(id: string): void {
    this.installed.add(id);
  }

  markMissing(id: string): void {
    this.installed.delete(id);
  }
}
