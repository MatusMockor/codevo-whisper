import { nativeImage, type NativeImage } from 'electron';
import { rasterizeMark, type MarkSpec, type Rgba } from './mark-raster';
import { encodePng } from './png';
import type { TrayIconKind } from './tray-status';

export const TRAY_POINT_SIZE = 16;
export const SPIN_FRAMES = 12;
export const SPIN_FRAME_MS = 110;

const SCALE_FACTORS = [1, 2] as const;
const TEMPLATE: Rgba = [0, 0, 0, 1];
const DIMMED: Rgba = [0, 0, 0, 0.45];
const AMBER: Rgba = [240, 162, 58, 1];

export type TrayIconSpec = MarkSpec & { template: boolean };

export function trayIconSpec(kind: TrayIconKind, frame = 0): TrayIconSpec {
  if (kind === 'recording') {
    return { color: AMBER, rotationDeg: 0, badge: false, template: false };
  }
  if (kind === 'processing') {
    return { color: TEMPLATE, rotationDeg: (frame % SPIN_FRAMES) * (180 / SPIN_FRAMES), badge: false, template: true };
  }
  if (kind === 'paused') {
    return { color: DIMMED, rotationDeg: 0, badge: false, template: true };
  }
  return { color: TEMPLATE, rotationDeg: 0, badge: kind === 'error', template: true };
}

function buildImage(spec: TrayIconSpec): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of SCALE_FACTORS) {
    const size = TRAY_POINT_SIZE * scaleFactor;
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: encodePng(size, size, rasterizeMark(size, spec)) });
  }
  image.setTemplateImage(spec.template);
  return image;
}

export class TrayIcons {
  private readonly cache = new Map<string, NativeImage>();

  image(kind: TrayIconKind, frame = 0): NativeImage {
    const key = kind === 'processing' ? `${kind}:${frame % SPIN_FRAMES}` : kind;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const image = buildImage(trayIconSpec(kind, frame));
    this.cache.set(key, image);
    return image;
  }
}
