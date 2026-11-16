import { Rng } from '../rng';
import { createNoise2D, fbm, ridged } from '../noise';
import { World, WorldGenParams } from './world';
import { BIOMES, Biome } from './biomes';
import { VEG_CAP_SCALE } from '../constants';
import { landmassName } from '../creatures/names';

export const DEFAULT_WORLDGEN: WorldGenParams = {
  width: 256,
  height: 160,
  landFraction: 0.46,
  islands: 0,
  moistureBias: 0,
  temperatureBias: 0,
  riverDensity: 1,
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Min-heap of tile indices keyed by float priority. */
class Heap {
  keys: Float32Array;
  vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float32Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number): void {
    let i = this.size++;
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p]; vals[i] = vals[p];
      i = p;
    }
    keys[i] = k; vals[i] = v;
  }
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    const k = keys[--this.size];
    const v = vals[this.size];
    let i = 0;
    const n = this.size;
    while (true) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c]; vals[i] = vals[c];
      i = c;
    }
    keys[i] = k; vals[i] = v;
    return top;
  }
}

const N8X = [1, -1, 0, 0, 1, 1, -1, -1];
const N8Y = [0, 0, 1, -1, 1, -1, 1, -1];

export interface GeneratedExtras {
  /** Lake mask kept for biome reclassification under climate change. */
  lake: Uint8Array;
}

export function generateWorld(p: WorldGenParams, rng: Rng): World {
  const W = p.width, H = p.height, n = W * H;
  const world = new World(W, H);
  const sea = world.seaLevel;
  const nCont = createNoise2D(rng.fork(11));
  const nMount = createNoise2D(rng.fork(12));
  const nMoist = createNoise2D(rng.fork(13));
  const nTemp = createNoise2D(rng.fork(14));
  const nDetail = createNoise2D(rng.fork(15));
  const nOre = createNoise2D(rng.fork(16));
  const nWarp = createNoise2D(rng.fork(17));
  const aspect = W / H;
  const offX = rng.range(0, 100), offY = rng.range(0, 100);

  // Island centers for archipelago worlds.
  const islands: { x: number; y: number; r: number }[] = [];
  if (p.islands > 0) {
    let attempts = 0;
    while (islands.length < p.islands && attempts++ < 2000) {
      const x = rng.range(0.14, 0.86), y = rng.range(0.16, 0.84);
      const r = rng.range(0.1, 0.16);
      if (islands.every((o) => Math.hypot((o.x - x) * aspect, o.y - y) > (o.r + r) * 1.25)) islands.push({ x, y, r });
    }
  }

  const raw = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H;
      const sx = nx * aspect * 2.2 + offX, sy = ny * 2.2 + offY;
      const wx = fbm(nWarp, sx * 0.8, sy * 0.8, 3) * 0.35;
      const wy = fbm(nWarp, sx * 0.8 + 50, sy * 0.8 + 50, 3) * 0.35;
      const c = fbm(nCont, sx + wx, sy + wy, 6);
      const dx = (nx - 0.5) * 2, dy = (ny - 0.5) * 2;
      let h: number;
      if (islands.length > 0) {
        let best = -1;
        for (const isl of islands) {
          const d = Math.hypot((nx - isl.x) * aspect + wx * 0.12, ny - isl.y + wy * 0.12) / isl.r + c * 0.55;
          best = Math.max(best, 1 - d);
        }
        h = Math.tanh(best * 2.2) * 0.55 + c * 0.3;
      } else {
        const edge = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
        h = c * 0.95 + 0.2 - smoothstep(0.62, 1.05, edge) * 1.3;
      }
      const m = ridged(nMount, sx * 1.7 + wx, sy * 1.7 + wy, 5);
      h += m * 0.5 * smoothstep(-0.05, 0.45, h);
      h += fbm(nDetail, sx * 7, sy * 7, 3) * 0.05;
      raw[y * W + x] = h;
    }
  }

  // Rank-normalize so the land fraction matches the request exactly.
  const sorted = Float32Array.from(raw).sort();
  const t = sorted[Math.min(n - 1, Math.floor((1 - p.landFraction) * n))];
  const min = sorted[0], max = sorted[n - 1];
  const elev = world.elevation;
  const landStart = Math.min(n - 1, Math.floor((1 - p.landFraction) * n));
  const landCount = Math.max(1, n - landStart);
  for (let i = 0; i < n; i++) {
    const r = raw[i];
    if (r <= t) {
      elev[i] = ((r - min) / Math.max(1e-6, t - min)) * sea * 0.999;
    } else {
      const lin = Math.pow((r - t) / Math.max(1e-6, max - t), 1.3);
      let a = lin;
      if (islands.length > 0) {
        // Rank-based blend keeps island interiors from becoming one big mountain.
        let lo = landStart, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < r) lo = mid + 1; else hi = mid; }
        const rank = (lo - landStart) / landCount;
        a = 0.35 * lin + 0.65 * Math.pow(rank, 2.6);
      }
      elev[i] = sea + a * (1 - sea);
    }
  }

  // Distance to ocean (for coastal moisture).
  const oceanDist = new Uint16Array(n).fill(65535);
  {
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) if (elev[i] < sea) { oceanDist[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++];
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const ax = x + N8X[k], ay = y + N8Y[k];
        if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const j = ay * W + ax;
        if (oceanDist[j] > oceanDist[i] + 1) { oceanDist[j] = oceanDist[i] + 1; q[tail++] = j; }
      }
    }
  }

  // Temperature and moisture.
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const sx = (x / W) * aspect * 2.2 + offX, sy = (y / H) * 2.2 + offY;
      const alt = Math.max(0, elev[i] - sea) / (1 - sea);
      world.baseTemp[i] = 29 - 44 * Math.pow(lat, 1.35) - alt * 30 + fbm(nTemp, sx * 1.5, sy * 1.5, 3) * 3 + p.temperatureBias;
      let m = 0.48 + 0.42 * fbm(nMoist, sx * 1.3, sy * 1.3, 5);
      m += 0.22 * (1 - Math.min(1, oceanDist[i] / 22));
      m -= 0.22 * Math.exp(-(((lat - 0.42) / 0.13) ** 2));
      m += 0.12 * Math.exp(-((lat / 0.18) ** 2));
      m -= alt * 0.1;
      m += p.moistureBias;
      world.moisture[i] = Math.min(1, Math.max(0, m));
    }
  }

  // Priority-flood depression filling: gives lakes and a drainage surface.
  const fill = Float32Array.from(elev);
  const done = new Uint8Array(n);
  const heap = new Heap(n);
  for (let i = 0; i < n; i++) {
    const x = i % W, y = (i / W) | 0;
    if (elev[i] < sea || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
      done[i] = 1;
      heap.push(fill[i], i);
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 8; k++) {
      const ax = x + N8X[k], ay = y + N8Y[k];
      if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      const j = ay * W + ax;
      if (done[j]) continue;
      done[j] = 1;
      fill[j] = Math.max(elev[j], fill[i] + 1e-5);
      heap.push(fill[j], j);
    }
  }
  const lake = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (elev[i] >= sea && fill[i] - elev[i] > 0.006) lake[i] = 1;

  // Flow directions + accumulation -> rivers.
  const down = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (elev[i] < sea) continue;
    const x = i % W, y = (i / W) | 0;
    let best = fill[i], bj = -1;
    for (let k = 0; k < 8; k++) {
      const ax = x + N8X[k], ay = y + N8Y[k];
      if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      const j = ay * W + ax;
      if (fill[j] < best) { best = fill[j]; bj = j; }
    }
    down[i] = bj;
  }
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => fill[b] - fill[a]);
  const acc = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    if (elev[i] < sea) continue;
    acc[i] += 0.15 + world.moisture[i];
    if (down[i] >= 0) acc[down[i]] += acc[i];
  }
  const landAcc: number[] = [];
  for (let i = 0; i < n; i++) if (elev[i] >= sea && !lake[i]) landAcc.push(acc[i]);
  landAcc.sort((a, b) => a - b);
  const riverFrac = 0.04 * p.riverDensity;
  const T = landAcc.length > 0 ? landAcc[Math.floor(landAcc.length * (1 - riverFrac))] : Infinity;
  for (let i = 0; i < n; i++) {
    if (elev[i] >= sea && !lake[i] && acc[i] >= T) {
      world.river[i] = Math.min(255, Math.round(60 + 50 * Math.log2(acc[i] / T + 1)));
    }
  }

  world.lake = lake;
  classifyBiomes(world, 0);

  // Ore deposits in highlands.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const alt = Math.max(0, elev[i] - sea) / (1 - sea);
      const o = fbm(nOre, x * 0.09, y * 0.09, 3);
      if (alt > 0.3 && o > 0.25) world.ore[i] = Math.min(255, Math.round((o - 0.25) * 600 + alt * 80));
    }
  }

  world.computeWaterDistance();
  computeFertility(world);
  for (let i = 0; i < n; i++) world.veg[i] = world.fertility[i] * VEG_CAP_SCALE * rng.range(0.55, 0.9);
  world.updateChunkFood();
  const nameRng = rng.fork(99);
  world.computeLandmasses(() => '');
  for (const lm of world.landmasses) lm.name = landmassName(nameRng, lm.size);
  return world;
}

/** Biome from elevation, moisture and (possibly shifted) temperature. */
export function classifyBiomes(world: World, tempOffset: number): void {
  const W = world.width, H = world.height, sea = world.seaLevel;
  const elev = world.elevation, lake = world.lake;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i];
      const temp = world.baseTemp[i] + tempOffset;
      const m = world.moisture[i];
      let b: number;
      if (e < sea) {
        const depth = sea - e;
        if (temp < -14) b = Biome.Glacier; // pack ice
        else b = depth > 0.16 ? Biome.DeepOcean : depth > 0.05 ? Biome.Ocean : Biome.Shallows;
      } else if (lake[i]) {
        b = temp < -16 ? Biome.Glacier : Biome.Lake;
      } else {
        const alt = (e - sea) / (1 - sea);
        let coastal = false;
        if (alt < 0.035) {
          for (let k = 0; k < 4 && !coastal; k++) {
            const ax = x + N8X[k], ay = y + N8Y[k];
            if (ax >= 0 && ay >= 0 && ax < W && ay < H && elev[ay * W + ax] < sea) coastal = true;
          }
        }
        if (alt > 0.72) b = temp < 2 ? Biome.SnowPeak : Biome.Mountain;
        else if (alt > 0.55) b = temp < -6 ? Biome.SnowPeak : Biome.Mountain;
        else if (temp < -9) b = Biome.Glacier;
        else if (coastal && temp > 4 && m < 0.8) b = Biome.Beach;
        else if (temp < -1) b = Biome.Tundra;
        else if (temp < 6) b = m > 0.42 ? Biome.Taiga : Biome.Tundra;
        else if (m > 0.8 && alt < 0.14) b = Biome.Swamp;
        else if (temp < 19) b = m < 0.22 ? Biome.Desert : m < 0.4 ? Biome.Shrubland : m < 0.6 ? Biome.Grassland : Biome.Forest;
        else b = m < 0.24 ? Biome.Desert : m < 0.42 ? Biome.Savanna : m < 0.64 ? Biome.Grassland : Biome.Rainforest;
      }
      world.biome[i] = b;
    }
  }
}

export function computeFertility(world: World): void {
  for (let i = 0; i < world.size; i++) {
    const b = world.biome[i];
    let f = BIOMES[b].fertility;
    if (f > 0) {
      const wd = world.waterDist[i];
      const riverBonus = wd <= 1 ? 0.45 : wd <= 4 ? 0.25 : wd <= 8 ? 0.1 : 0;
      f = f * (0.75 + 0.45 * world.moisture[i]) * (1 + riverBonus);
    }
    world.fertility[i] = f;
  }
}

export function isPassableLand(world: World, i: number): boolean {
  const b = world.biome[i];
  return b > Biome.Lake && b !== Biome.SnowPeak;
}
