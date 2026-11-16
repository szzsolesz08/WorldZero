import type { TerrainPayload } from '../worker/protocol';
import { BIOMES, Biome } from '../engine/world/biomes';

/** Pixels per tile in the painted terrain texture. */
export const TPX = 8;

const NOISE_SIZE = 512;
let warpX: Float32Array | null = null;
let warpY: Float32Array | null = null;
let grain: Float32Array | null = null;

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth tileable value noise. */
function valueNoise(size: number, cell: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  const n = size / cell;
  for (let y = 0; y < size; y++) {
    const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < size; x++) {
      const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
      const a = hash(x0 % n, y0 % n, seed), b = hash((x0 + 1) % n, y0 % n, seed);
      const c = hash(x0 % n, (y0 + 1) % n, seed), d = hash((x0 + 1) % n, (y0 + 1) % n, seed);
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function ensureNoise(): void {
  if (warpX) return;
  const a1 = valueNoise(NOISE_SIZE, 32, 1), a2 = valueNoise(NOISE_SIZE, 8, 2);
  const b1 = valueNoise(NOISE_SIZE, 32, 3), b2 = valueNoise(NOISE_SIZE, 8, 4);
  warpX = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  warpY = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < warpX.length; i++) {
    warpX[i] = (a1[i] * 0.65 + a2[i] * 0.35 - 0.5) * 2.2;
    warpY[i] = (b1[i] * 0.65 + b2[i] * 0.35 - 0.5) * 2.2;
  }
  const g1 = valueNoise(NOISE_SIZE, 2, 5), g2 = valueNoise(NOISE_SIZE, 4, 6);
  grain = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < grain.length; i++) grain[i] = g1[i] * 0.55 + g2[i] * 0.45 - 0.5;
}

/** Per-biome texture amplitude and darkness clumping. */
const TEXTURE: Record<number, { amp: number; clump: number }> = {
  [Biome.Forest]: { amp: 34, clump: 0.6 },
  [Biome.Rainforest]: { amp: 34, clump: 0.65 },
  [Biome.Taiga]: { amp: 30, clump: 0.55 },
  [Biome.Swamp]: { amp: 24, clump: 0.4 },
  [Biome.Mountain]: { amp: 26, clump: 0 },
  [Biome.Desert]: { amp: 10, clump: 0 },
  [Biome.Savanna]: { amp: 16, clump: 0.2 },
  [Biome.Grassland]: { amp: 14, clump: 0.1 },
  [Biome.Shrubland]: { amp: 20, clump: 0.3 },
  [Biome.Tundra]: { amp: 14, clump: 0 },
  [Biome.Glacier]: { amp: 6, clump: 0 },
  [Biome.SnowPeak]: { amp: 8, clump: 0 },
  [Biome.Beach]: { amp: 8, clump: 0 },
};

/**
 * Paint the terrain into a canvas at TPX pixels per tile: domain-warped biome boundaries,
 * smooth coastlines from bilinear elevation, hillshading, depth-shaded water and rivers.
 */
export function paintTerrain(t: TerrainPayload, canvas: HTMLCanvasElement): void {
  ensureNoise();
  const W = t.width, H = t.height, sea = t.seaLevel;
  const cw = W * TPX, ch = H * TPX;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cw, ch);
  const data = img.data;
  const elev = t.elevation, biome = t.biome;

  // Tile-level hillshade (light from the north-west).
  const shade = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = elev[y * W + Math.max(0, x - 1)], r = elev[y * W + Math.min(W - 1, x + 1)];
      const u = elev[Math.max(0, y - 1) * W + x], d = elev[Math.min(H - 1, y + 1) * W + x];
      const land = elev[i] >= sea;
      const k = land ? 9 : 2.5;
      shade[i] = Math.max(-0.45, Math.min(0.45, ((l - r) + (u - d)) * k));
    }
  }
  // Tile colours with gentle moisture/altitude variation.
  const tr = new Float32Array(W * H), tg = new Float32Array(W * H), tb = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const b = biome[i];
    const c = BIOMES[b].color;
    let r = c[0], g = c[1], bl = c[2];
    if (b > Biome.Lake) {
      const alt = Math.max(0, (elev[i] - sea) / (1 - sea));
      const m = t.moisture[i];
      r += (0.5 - m) * 14 + alt * 18;
      g += (m - 0.5) * 10 + alt * 10;
      bl += alt * 14;
    }
    tr[i] = r; tg[i] = g; tb[i] = bl;
  }

  const wx = warpX!, wy = warpY!, gr = grain!;
  const NM = NOISE_SIZE - 1;
  for (let py = 0; py < ch; py++) {
    const fy = (py + 0.5) / TPX - 0.5;
    let y0 = Math.floor(fy);
    const ty = fy - y0;
    let y1 = y0 + 1;
    if (y0 < 0) y0 = 0;
    if (y1 >= H) y1 = H - 1;
    for (let px = 0; px < cw; px++) {
      const fx = (px + 0.5) / TPX - 0.5;
      let x0 = Math.floor(fx);
      const tx = fx - x0;
      let x1 = x0 + 1;
      if (x0 < 0) x0 = 0;
      if (x1 >= W) x1 = W - 1;
      const i00 = y0 * W + x0, i10 = y0 * W + x1, i01 = y1 * W + x0, i11 = y1 * W + x1;
      const e = (elev[i00] * (1 - tx) + elev[i10] * tx) * (1 - ty) + (elev[i01] * (1 - tx) + elev[i11] * tx) * ty;
      const sh = (shade[i00] * (1 - tx) + shade[i10] * tx) * (1 - ty) + (shade[i01] * (1 - tx) + shade[i11] * tx) * ty;
      const ni = (py & NM) * NOISE_SIZE + (px & NM);
      const gn = gr[ni];
      // Domain-warped nearest tile for organic biome borders.
      let sx = Math.floor((px + 0.5) / TPX + wx[ni]);
      let sy = Math.floor((py + 0.5) / TPX + wy[ni]);
      if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
      if (sy < 0) sy = 0; else if (sy >= H) sy = H - 1;
      let ti = sy * W + sx;
      let r: number, g: number, b: number;
      const o = (py * cw + px) * 4;
      if (e < sea) {
        // Ocean: depth-shaded with a coastal glow and foam.
        const depth = (sea - e) / sea;
        const dd = Math.min(1, depth * 3.2);
        r = 46 - 36 * dd; g = 120 - 86 * dd; b = 148 - 82 * dd;
        if (depth < 0.012) { const f = 1 - depth / 0.012; r += 70 * f; g += 70 * f; b += 60 * f; }
        if (biome[ti] === Biome.Glacier) { r = 200; g = 216; b = 228; }
        r += gn * 6; g += gn * 6; b += gn * 8;
        r += sh * 40; g += sh * 40; b += sh * 40;
      } else {
        let bt = biome[ti];
        if (bt <= Biome.Ocean || bt === Biome.Shallows) {
          // Warp landed on sea though this pixel is land: use the tile under the pixel instead.
          const ux = Math.min(W - 1, Math.max(0, Math.round(fx))), uy = Math.min(H - 1, Math.max(0, Math.round(fy)));
          ti = uy * W + ux;
          bt = biome[ti];
          if (bt <= Biome.Shallows) bt = Biome.Beach;
        }
        if (bt === Biome.Lake) {
          r = 44 + gn * 6; g = 104 + gn * 6; b = 138 + gn * 8;
        } else {
          r = bt === biome[ti] ? tr[ti] : BIOMES[bt].color[0];
          g = bt === biome[ti] ? tg[ti] : BIOMES[bt].color[1];
          b = bt === biome[ti] ? tb[ti] : BIOMES[bt].color[2];
          // Blend toward the bilinear land colour so biome borders feather.
          if (biome[i00] > Biome.Lake && biome[i10] > Biome.Lake && biome[i01] > Biome.Lake && biome[i11] > Biome.Lake) {
            const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
            const br = tr[i00] * w00 + tr[i10] * w10 + tr[i01] * w01 + tr[i11] * w11;
            const bg = tg[i00] * w00 + tg[i10] * w10 + tg[i01] * w01 + tg[i11] * w11;
            const bb = tb[i00] * w00 + tb[i10] * w10 + tb[i01] * w01 + tb[i11] * w11;
            r = r * 0.55 + br * 0.45; g = g * 0.55 + bg * 0.45; b = b * 0.55 + bb * 0.45;
          }
          const tex = TEXTURE[bt];
          if (tex) {
            let n = gn * tex.amp;
            if (tex.clump > 0 && gn > 0.1) n -= tex.clump * 30 * (gn - 0.1);
            r += n; g += n; b += n * 0.8;
          }
          const lit = 1 + sh * 1.15;
          r *= lit; g *= lit; b *= lit;
          // Very slight coastal darkening just above the sea line.
          if (e - sea < 0.004) { r *= 0.92; g *= 0.94; b *= 0.94; }
        }
      }
      data[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  paintRivers(t, ctx);
}

function paintRivers(t: TerrainPayload, ctx: CanvasRenderingContext2D): void {
  const W = t.width, H = t.height, sea = t.seaLevel;
  const river = t.river, elev = t.elevation, biome = t.biome;
  const buckets: [number, number, number, number][][] = [[], [], []];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!river[i] || biome[i] <= Biome.Lake) continue;
      let best = -1, be = elev[i] + 1e-6;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          const isWater = elev[j] < sea || biome[j] === Biome.Lake;
          if ((river[j] || isWater) && elev[j] < be) { be = elev[j]; best = j; }
        }
      }
      if (best < 0) continue;
      const k = river[i] > 170 ? 2 : river[i] > 110 ? 1 : 0;
      buckets[k].push([x, y, best % W, Math.floor(best / W)]);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const widths = [0.16, 0.26, 0.38];
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 3; k++) {
      ctx.lineWidth = TPX * widths[k] * (pass === 0 ? 1.8 : 1);
      ctx.strokeStyle = pass === 0 ? 'rgba(30, 60, 70, 0.25)' : 'rgba(78, 148, 186, 0.95)';
      ctx.beginPath();
      for (const [x, y, nx, ny] of buckets[k]) {
        ctx.moveTo((x + 0.5) * TPX, (y + 0.5) * TPX);
        ctx.lineTo((nx + 0.5) * TPX, (ny + 0.5) * TPX);
      }
      ctx.stroke();
    }
  }
}
