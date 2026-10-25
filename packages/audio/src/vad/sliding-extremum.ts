type Entry = { index: number; value: number };

export class SlidingExtremum {
  private readonly entries: Entry[] = [];
  private head = 0;
  private pushed = 0;

  constructor(
    private readonly windowSize: number,
    private readonly keeps: (candidate: number, existing: number) => boolean,
  ) {}

  push(value: number): void {
    while (this.entries.length > this.head && this.keeps(value, this.entries[this.entries.length - 1]?.value ?? value)) {
      this.entries.pop();
    }
    this.entries.push({ index: this.pushed, value });
    this.pushed += 1;
    while ((this.entries[this.head]?.index ?? this.pushed) <= this.pushed - 1 - this.windowSize) {
      this.head += 1;
    }
    this.compact();
  }

  get value(): number {
    const first = this.entries[this.head];
    if (first === undefined) {
      throw new RangeError('SlidingExtremum is empty');
    }
    return first.value;
  }

  private compact(): void {
    if (this.head < 1024) {
      return;
    }
    this.entries.splice(0, this.head);
    this.head = 0;
  }
}
