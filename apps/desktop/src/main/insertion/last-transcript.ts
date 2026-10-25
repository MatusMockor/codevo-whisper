export class LastTranscript {
  private text: string | null = null;

  set(text: string): void {
    this.text = text;
  }

  get(): string | null {
    return this.text;
  }
}
