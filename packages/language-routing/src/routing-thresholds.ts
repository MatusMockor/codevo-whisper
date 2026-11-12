export type RoutingThresholdValues = { confidence: number; foreign: number; guardSimilarity: number };

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export class RoutingThresholds {
  private constructor(
    readonly confidence: number,
    readonly foreign: number,
    readonly guardSimilarity: number,
  ) {}

  static of(values: RoutingThresholdValues): RoutingThresholds {
    const invalid = Object.entries(values).find(([, value]) => !isUnitInterval(value));
    if (invalid !== undefined) {
      throw new RangeError(`routing threshold ${invalid[0]} must be within [0, 1]`);
    }
    return new RoutingThresholds(values.confidence, values.foreign, values.guardSimilarity);
  }

  static fleurs(): RoutingThresholds {
    return RoutingThresholds.of({ confidence: 0.99, foreign: 0.99, guardSimilarity: 0.5 });
  }
}
