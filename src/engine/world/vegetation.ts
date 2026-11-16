import { Rng } from '../rng';
import { World } from './world';
import { Climate } from './climate';
import { VEG_CAP_SCALE, VEG_GROWTH } from '../constants';

export interface VegetationResult {
  burning: number;
  total: number;
  capacity: number;
}

/**
 * One vegetation pass: logistic regrowth toward a climate-dependent cap, winter die-back,
 * farm boosts, and wildfire spread. Called every VEG_INTERVAL ticks.
 */
export function updateVegetation(world: World, climate: Climate, rng: Rng, tick: number, foodMult: number): VegetationResult {
  climate.stampRain(world);
  const W = world.width, H = world.height;
  const veg = world.veg, fert = world.fertility, fire = world.fire, rain = world.rain;
  const global = climate.globalOffset();
  const rainEff = climate.effectiveRain();
  const rainPow = Math.pow(Math.max(0.05, rainEff), 0.7);
  let burning = 0, total = 0, capacity = 0;

  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    const seasonal = climate.seasonalOffset(tick, lat);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const f = fert[i];
      if (f <= 0) { veg[i] = 0; fire[i] = 0; continue; }
      const temp = world.baseTemp[i] + seasonal + global;
      const tf = temp < -6 ? 0 : temp < 6 ? (temp + 6) / 12 : temp > 36 ? Math.max(0, 1 - (temp - 36) / 12) : 1;
      const nearWater = world.waterDist[i] <= 2;
      let wf = (0.35 + 0.65 * world.moisture[i] + rain[i] * 0.6) * (nearWater ? Math.max(rainPow, 0.85) : rainPow);
      if (wf > 1.3) wf = 1.3;
      let cap = f * VEG_CAP_SCALE * foodMult * (0.3 + 0.7 * tf) * Math.min(1, 0.35 + 0.65 * wf);
      let growth = VEG_GROWTH * tf * wf;
      if (world.farm[i]) { cap *= 1.9; growth *= 1.6; }
      let v = veg[i];

      if (fire[i] > 0) {
        burning++;
        v -= 1.5 * (fire[i] / 255) * VEG_CAP_SCALE * 0.25;
        let fi = fire[i] - 22 - rain[i] * 140;
        if (v <= 0.3) { v = 0; fi = 0; }
        fire[i] = fi > 0 ? fi : 0;
        if (fire[i] > 60) {
          // Spread to neighbours with dry, dense vegetation.
          for (let k = 0; k < 4; k++) {
            const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (fire[j] > 0 || fert[j] <= 0) continue;
            const dryness = (1 - world.moisture[j] * 0.6) * (1 - rain[j]);
            const p = (veg[j] / VEG_CAP_SCALE) * 0.55 * dryness;
            if (rng.next() < p) fire[j] = 200 + rng.int(0, 55);
          }
        }
        if (v < 0) v = 0;
      } else if (v < cap) {
        const fill = v / (cap * 0.5);
        v += growth * (cap - v) * (0.35 + 0.65 * (fill > 1 ? 1 : fill));
      } else {
        v -= (v - cap) * 0.05;
      }
      veg[i] = v;
      total += v;
      capacity += cap;
    }
  }
  world.updateChunkFood();
  return { burning, total, capacity };
}

export function ignite(world: World, x: number, y: number, radius: number, rng: Rng): number {
  let lit = 0;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const tx = Math.floor(x + dx), ty = Math.floor(y + dy);
      if (!world.inBounds(tx, ty)) continue;
      const i = world.idx(tx, ty);
      if (world.fertility[i] > 0 && world.veg[i] > 0.5 && rng.chance(0.7)) {
        world.fire[i] = 230;
        lit++;
      }
    }
  }
  return lit;
}
