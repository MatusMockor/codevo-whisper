import { describe, expect, it } from 'vitest';
import { bottomCenter, displayWorkArea } from '../src/main/windows/overlay-placement';

describe('bottomCenter', () => {
  it('centers the overlay above the bottom edge of the work area', () => {
    expect(bottomCenter({ x: 0, y: 25, width: 1512, height: 920 })).toEqual({ x: 526, y: 733, width: 460, height: 184 });
  });

  it('places the overlay on a secondary display with negative coordinates', () => {
    expect(bottomCenter({ x: -1920, y: -200, width: 1920, height: 1080 }, { width: 400, height: 100 }, 20)).toEqual({ x: -1160, y: 760, width: 400, height: 100 });
  });
});

describe('displayWorkArea', () => {
  const hdmi = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const primary = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 32, width: 2560, height: 977 } };
  const desktopAreas = [{ x: 1920, y: 32, width: 2560, height: 1337 }, { x: 0, y: 0, width: 1920, height: 1009 }];

  it('keeps the overlay above a dock the display work area does not report', () => {
    expect(displayWorkArea(hdmi, desktopAreas)).toEqual({ x: 0, y: 0, width: 1920, height: 1009 });
    expect(bottomCenter(displayWorkArea(hdmi, desktopAreas)).y + 184).toBeLessThanOrEqual(1009);
  });

  it('uses the per-monitor work area when the display work area is merged across monitors', () => {
    expect(displayWorkArea(primary, desktopAreas)).toEqual({ x: 1920, y: 32, width: 2560, height: 1337 });
  });

  it('falls back to the display work area when no desktop work area belongs to the display', () => {
    expect(displayWorkArea(hdmi, [])).toEqual(hdmi.workArea);
    expect(displayWorkArea(hdmi, [{ x: 0, y: 0, width: 3840, height: 2018 }])).toEqual(hdmi.workArea);
  });
});
