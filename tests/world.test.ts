import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { generateWorld, DEFAULT_WORLDGEN } from '../src/engine/world/worldgen';
import { Biome } from '../src/engine/world/biomes';
import { Climate } from '../src/engine/world/climate';
import { updateVegetation } from '../src/engine/world/vegetation';

function landFraction(w: ReturnType<typeof generateWorld>): number {
  let land = 0;
  for (let i = 0; i < w.size; i++) if (w.isLand(i)) land++;
  return land / w.size;
}

describe('rng', () => {
  it('is deterministic and resumable', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const st = a.getState();
    const x = a.next();
    const c = new Rng(0);
    c.setState(st);
    expect(c.next()).toBe(x);
  });
});

describe('world generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateWorld(DEFAULT_WORLDGEN, new Rng('alpha'));
    const b = generateWorld(DEFAULT_WORLDGEN, new Rng('alpha'));
    expect(Array.from(a.elevation.slice(0, 500))).toEqual(Array.from(b.elevation.slice(0, 500)));
    expect(Array.from(a.biome)).toEqual(Array.from(b.biome));
  });

  it('differs between seeds', () => {
    const a = generateWorld(DEFAULT_WORLDGEN, new Rng('alpha'));
    const b = generateWorld(DEFAULT_WORLDGEN, new Rng('beta'));
    let diff = 0;
    for (let i = 0; i < a.size; i++) if (a.biome[i] !== b.biome[i]) diff++;
    expect(diff / a.size).toBeGreaterThan(0.2);
  });

  it('has realistic land, rivers, biomes and a fresh-water field', () => {
    for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
      const w = generateWorld(DEFAULT_WORLDGEN, new Rng(seed));
      const lf = landFraction(w);
      expect(lf).toBeGreaterThan(0.3);
      expect(lf).toBeLessThan(0.7);
      let rivers = 0;
      const biomes = new Set<number>();
      for (let i = 0; i < w.size; i++) {
        if (w.river[i] > 0) rivers++;
        biomes.add(w.biome[i]);
        if (w.isFreshWater(i)) expect(w.waterDist[i]).toBe(0);
      }
      expect(rivers).toBeGreaterThan(50);
      expect(biomes.size).toBeGreaterThanOrEqual(8);
      expect(w.landmasses.length).toBeGreaterThan(0);
    }
  });

  it('builds archipelagos with several landmasses', () => {
    const w = generateWorld({ ...DEFAULT_WORLDGEN, islands: 6, landFraction: 0.3 }, new Rng('isles'));
    const lf = landFraction(w);
    expect(lf).toBeGreaterThan(0.15);
    expect(lf).toBeLessThan(0.5);
    const big = w.landmasses.filter((l) => l.size > 150);
    expect(big.length).toBeGreaterThanOrEqual(3);
  });

  it('vegetation regrows after grazing and dies back in deep cold', () => {
    const w = generateWorld(DEFAULT_WORLDGEN, new Rng('veg'));
    const climate = new Climate();
    const rng = new Rng(1);
    let grass = -1;
    for (let i = 0; i < w.size; i++) if (w.biome[i] === Biome.Grassland && w.fertility[i] > 0.6) { grass = i; break; }
    expect(grass).toBeGreaterThanOrEqual(0);
    w.veg[grass] = 0.1;
    for (let t = 0; t < 200; t++) updateVegetation(w, climate, rng, t * 10, 1);
    expect(w.veg[grass]).toBeGreaterThan(2);
    climate.tempOffset = -40;
    const before = w.veg[grass];
    for (let t = 0; t < 200; t++) updateVegetation(w, climate, rng, t * 10, 1);
    expect(w.veg[grass]).toBeLessThan(before * 0.5);
  });
});
