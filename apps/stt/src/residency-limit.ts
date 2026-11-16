export interface ResidentCandidate {
  resident(): boolean;
  loading(): boolean;
  inUse(): boolean;
  lastUsed(): number;
  unload(): Promise<void>;
}

export class ResidencyLimit {
  private readonly candidates: ResidentCandidate[] = [];
  private clock = 0;

  constructor(private readonly maxResident: number) {}

  register(candidate: ResidentCandidate): void {
    this.candidates.push(candidate);
  }

  stamp(): number {
    this.clock += 1;
    return this.clock;
  }

  async makeRoomFor(candidate: ResidentCandidate): Promise<void> {
    const others = (): ResidentCandidate[] => this.candidates.filter((other) => other !== candidate);
    while (others().filter(occupies).length >= this.maxResident) {
      if (!(await this.evictFrom(others()))) {
        return;
      }
    }
  }

  async trim(keep?: ResidentCandidate): Promise<void> {
    const evictable = (): ResidentCandidate[] => this.candidates.filter((candidate) => candidate !== keep);
    while (this.candidates.filter(occupies).length > this.maxResident) {
      if (!(await this.evictFrom(evictable()))) {
        return;
      }
    }
  }

  private async evictFrom(candidates: readonly ResidentCandidate[]): Promise<boolean> {
    const [victim] = candidates.filter(isIdleResident).sort((left, right) => left.lastUsed() - right.lastUsed());
    if (victim === undefined) {
      return false;
    }
    await victim.unload();
    return true;
  }
}

function occupies(candidate: ResidentCandidate): boolean {
  return candidate.resident() || candidate.loading();
}

function isIdleResident(candidate: ResidentCandidate): boolean {
  return candidate.resident() && !candidate.loading() && !candidate.inUse();
}
