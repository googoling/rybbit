// Canvas heat rendering (simpleheat-style): accumulate radial gradients into an
// alpha buffer, then colorize through a 256-entry gradient LUT. Includes a diverging
// renderer for conversion-diff maps (converters − everyone).

export interface HeatPoint {
  x: number; // canvas px
  y: number; // canvas px
  value: number; // weight (signed for diff)
}

export interface DrawOptions {
  points: HeatPoint[];
  width: number;
  height: number;
  radius?: number;
  max?: number;
  minOpacity?: number;
}

const DEFAULT_GRADIENT: Record<number, string> = {
  0.0: "rgba(0,0,255,0)",
  0.2: "rgba(0,0,255,0.7)",
  0.4: "rgba(0,255,255,0.8)",
  0.6: "rgba(0,255,0,0.85)",
  0.8: "rgba(255,255,0,0.9)",
  1.0: "rgba(255,0,0,1)",
};

// Diverging: strong negative (cold blue) → 0 (clear) → strong positive (hot red).
const DIVERGING_NEG = [37, 99, 235]; // blue-600
const DIVERGING_POS = [220, 38, 38]; // red-600

function buildGradientLut(stops: Record<number, string>): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  for (const stop in stops) {
    gradient.addColorStop(Number(stop), stops[stop]);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);
  return ctx.getImageData(0, 0, 1, 256).data;
}

function buildBrush(radius: number, blur: number): HTMLCanvasElement {
  const brush = document.createElement("canvas");
  const r2 = radius + blur;
  brush.width = brush.height = r2 * 2;
  const ctx = brush.getContext("2d")!;
  const gradient = ctx.createRadialGradient(r2, r2, radius * 0.15, r2, r2, r2);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, r2 * 2, r2 * 2);
  return brush;
}

// Paint an alpha-only intensity layer from positive-weighted points.
function paintIntensity(
  width: number,
  height: number,
  points: HeatPoint[],
  radius: number,
  blur: number,
  max: number,
  minOpacity: number
): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const brush = buildBrush(radius, blur);
  const r2 = radius + blur;

  for (const p of points) {
    if (p.value <= 0) continue;
    ctx.globalAlpha = Math.min(Math.max(p.value / max, minOpacity), 1);
    ctx.drawImage(brush, p.x - r2, p.y - r2);
  }

  return ctx.getImageData(0, 0, width, height).data;
}

function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
}

// Standard single-sign heatmap (clicks / attention / rage / dead).
export function drawHeatmap(ctx: CanvasRenderingContext2D, opts: DrawOptions): void {
  const { points, width, height } = opts;
  clearCanvas(ctx, width, height);
  if (!points.length) return;

  const radius = opts.radius ?? Math.max(12, Math.round(width / 70));
  const blur = Math.round(radius * 0.9);
  const minOpacity = opts.minOpacity ?? 0.05;
  const max = opts.max ?? Math.max(...points.map(p => p.value), 1);

  const intensity = paintIntensity(width, height, points, radius, blur, max, minOpacity);
  const lut = buildGradientLut(DEFAULT_GRADIENT);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < intensity.length; i += 4) {
    const alpha = intensity[i + 3];
    if (alpha === 0) continue;
    const offset = alpha * 4;
    data[i] = lut[offset];
    data[i + 1] = lut[offset + 1];
    data[i + 2] = lut[offset + 2];
    data[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
}

// Diverging heatmap for conversion diff: blue where non-converters dominate, red where
// converters dominate. Two intensity passes (|positive|, |negative|) combined per pixel.
export function drawDiffHeatmap(ctx: CanvasRenderingContext2D, opts: DrawOptions): void {
  const { points, width, height } = opts;
  clearCanvas(ctx, width, height);
  if (!points.length) return;

  const radius = opts.radius ?? Math.max(12, Math.round(width / 70));
  const blur = Math.round(radius * 0.9);
  const minOpacity = opts.minOpacity ?? 0.05;
  const maxAbs = opts.max ?? Math.max(...points.map(p => Math.abs(p.value)), 1);

  const positives = points.filter(p => p.value > 0).map(p => ({ ...p, value: p.value }));
  const negatives = points.filter(p => p.value < 0).map(p => ({ ...p, value: -p.value }));

  const pos = paintIntensity(width, height, positives, radius, blur, maxAbs, minOpacity);
  const neg = paintIntensity(width, height, negatives, radius, blur, maxAbs, minOpacity);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < pos.length; i += 4) {
    const p = pos[i + 3];
    const n = neg[i + 3];
    if (p === 0 && n === 0) continue;
    const alpha = Math.max(p, n);
    const color = p >= n ? DIVERGING_POS : DIVERGING_NEG;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
}
