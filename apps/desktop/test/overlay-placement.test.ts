import { describe, expect, it } from 'vitest';
import { bottomCenter } from '../src/main/windows/overlay-placement';

describe('bottomCenter', () => {
  it('centers the overlay above the bottom edge of the work area', () => {
    expect(bottomCenter({ x: 0, y: 25, width: 1512, height: 920 })).toEqual({ x: 546, y: 749, width: 420, height: 168 });
  });

  it('places the overlay on a secondary display with negative coordinates', () => {
    expect(bottomCenter({ x: -1920, y: -200, width: 1920, height: 1080 }, { width: 400, height: 100 }, 20)).toEqual({ x: -1160, y: 760, width: 400, height: 100 });
  });
});
