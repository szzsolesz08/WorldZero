import { BIOMES, Biome } from './biomes';
import { CHUNK } from '../constants';

export interface Landmass {
  id: number;
  size: number;
  cx: number;
  cy: number;
  name: string;
}

export interface WorldGenParams {
  width: number;
  height: number;
  /** Fraction of tiles that are land (0..1). */
  landFraction: number;
  /** Number of separate islands; 0 = continents. */
  islands: number;
  moistureBias: number;
  temperatureBias: number;
  riverDensity: number;
}

/**
 * The physical world: terrain, water, biomes and vegetation stored as flat typed arrays.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  seaLevel = 0.45;
  /** Elevation 0..1 */
  elevation: Float32Array;
  moisture: Float32Array;
  /** Mean annual temperature (°C) */
  baseTemp: Float32Array;
  biome: Uint8Array;
  /** River flow strength (0 = none) */
  river: Uint8Array;
  /** Soil fertility multiplier */
  fertility: Float32Array;
  /** Current vegetation units */
  veg: Float32Array;
  /** Distance (tiles) to nearest fresh water, capped at 255 */
  waterDist: Uint8Array;
  /** Landmass id per tile, -1 for water */
  landmass: Int16Array;
  /** Ore richness 0..255 */
  ore: Uint8Array;
  /** Fire intensity 0..255 */
  fire: Uint8Array;
  /** Farm flag (tribe-tended) */
  farm: Uint8Array;
  /** Territory owner tribe id, -1 none */
  territory: Int16Array;
  /** Recent rain amount 0..1 */
  rain: Float32Array;
  /** Lake (inland fresh water) mask */
  lake: Uint8Array;
  /** Coarse food density per chunk */
  chunkFood: Float32Array;
  readonly chunksX: number;
  readonly chunksY: number;
  landmasses: Landmass[] = [];
  /** Bumped whenever terrain changes so renderers can repaint. */
  terrainVersion = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    const n = this.size;
    this.elevation = new Float32Array(n);
    this.moisture = new Float32Array(n);
    this.baseTemp = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.river = new Uint8Array(n);
    this.fertility = new Float32Array(n);
    this.veg = new Float32Array(n);
    this.waterDist = new Uint8Array(n);
    this.landmass = new Int16Array(n);
    this.ore = new Uint8Array(n);
    this.fire = new Uint8Array(n);
    this.farm = new Uint8Array(n);
    this.territory = new Int16Array(n).fill(-1);
    this.rain = new Float32Array(n);
    this.lake = new Uint8Array(n);
    this.chunksX = Math.ceil(width / CHUNK);
    this.chunksY = Math.ceil(height / CHUNK);
    this.chunkFood = new Float32Array(this.chunksX * this.chunksY);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Tile index for continuous coordinates, clamped to the map. */
  tileAt(x: number, y: number): number {
    let tx = x | 0, ty = y | 0;
    if (tx < 0) tx = 0; else if (tx >= this.width) tx = this.width - 1;
    if (ty < 0) ty = 0; else if (ty >= this.height) ty = this.height - 1;
    return ty * this.width + tx;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWater(i: number): boolean {
    return this.biome[i] <= Biome.Lake;
  }

  isLand(i: number): boolean {
    return this.biome[i] > Biome.Lake;
  }

  /** Can a creature drink here? (lake, river, swamp, or adjacent to one) */
  isFreshWater(i: number): boolean {
    const b = this.biome[i];
    return b === Biome.Lake || b === Biome.Swamp || this.river[i] > 0;
  }

  /**
   * Movement multiplier for a creature on tile i. 0 = impassable.
   * swim: creature's swim ability 0..1; sail: tribe knows sailing.
   */
  moveMult(i: number, swim: number, sail: boolean): number {
    const b = this.biome[i];
    if (b === Biome.DeepOcean) return swim > 0.8 ? 0.45 : 0;
    if (b === Biome.Ocean) return swim > 0.6 ? 0.5 : sail ? 0.7 : 0;
    if (b === Biome.Shallows) return swim > 0.35 ? 0.6 : sail ? 0.8 : 0;
    if (b === Biome.Lake) return swim > 0.3 ? 0.6 : sail ? 0.8 : 0;
    let m = BIOMES[b].moveMult;
    if (this.river[i] > 0) m *= 0.75;
    return m;
  }

  updateChunkFood(): void {
    const cf = this.chunkFood;
    cf.fill(0);
    const w = this.width;
    for (let y = 0; y < this.height; y++) {
      const cy = (y / CHUNK) | 0;
      for (let x = 0; x < w; x++) {
        cf[cy * this.chunksX + ((x / CHUNK) | 0)] += this.veg[y * w + x];
      }
    }
    const inv = 1 / (CHUNK * CHUNK);
    for (let i = 0; i < cf.length; i++) cf[i] *= inv;
  }

  /** Breadth-first distance-to-fresh-water field over land. */
  computeWaterDistance(): void {
    const n = this.size, w = this.width, h = this.height;
    const dist = this.waterDist;
    dist.fill(255);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) {
      if (this.isFreshWater(i)) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i] + 1;
      if (d >= 255) continue;
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] > d && (this.isLand(j) || this.biome[j] === Biome.Lake)) {
          dist[j] = d;
          queue[tail++] = j;
        }
      }
    }
  }

  /** Label connected land components. */
  computeLandmasses(names: (id: number) => string): void {
    const n = this.size, w = this.width, h = this.height;
    const lm = this.landmass;
    lm.fill(-1);
    this.landmasses = [];
    const stack = new Int32Array(n);
    let id = 0;
    for (let s = 0; s < n; s++) {
      if (lm[s] !== -1 || !this.isLand(s)) continue;
      let sp = 0, size = 0, sx = 0, sy = 0;
      stack[sp++] = s;
      lm[s] = id;
      while (sp > 0) {
        const i = stack[--sp];
        size++;
        const x = i % w, y = (i / w) | 0;
        sx += x; sy += y;
        if (x > 0) { const j = i - 1; if (lm[j] === -1 && this.isLand(j)) { lm[j] = id; stack[sp++] = j; } }
        if (x < w - 1) { const j = i + 1; if (lm[j] === -1 && this.isLand(j)) { lm[j] = id; stack[sp++] = j; } }
        if (y > 0) { const j = i - w; if (lm[j] === -1 && this.isLand(j)) { lm[j] = id; stack[sp++] = j; } }
        if (y < h - 1) { const j = i + w; if (lm[j] === -1 && this.isLand(j)) { lm[j] = id; stack[sp++] = j; } }
      }
      this.landmasses.push({ id, size, cx: sx / size, cy: sy / size, name: names(id) });
      id++;
    }
  }

  /** Find the nearest land tile center to (x, y), searching outward. Returns null if none nearby. */
  nearestLand(x: number, y: number, maxR = 40): { x: number; y: number } | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (this.inBounds(cx, cy) && this.isLand(this.idx(cx, cy))) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = cx + dx, ty = cy + dy;
          if (!this.inBounds(tx, ty)) continue;
          const i = this.idx(tx, ty);
          if (this.isLand(i) && this.biome[i] !== Biome.Glacier && this.biome[i] !== Biome.SnowPeak) {
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
