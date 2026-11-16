import { describe, it, expect } from 'vitest';
import { Rng } from '../src/engine/rng';
import { SpeciesRegistry } from '../src/engine/evolution/species';
import { Creature } from '../src/engine/creatures/creature';
import { genomeFromTemplate, geneticDistance, inherit, GENE_COUNT, G } from '../src/engine/creatures/genome';
import { World } from '../src/engine/world/world';

function makeWorld(): World {
  const w = new World(64, 32);
  // One landmass covering everything.
  w.biome.fill(7);
  w.computeLandmasses(() => 'Test');
  return w;
}

describe('genetics', () => {
  it('inheritance stays within bounds and mutates', () => {
    const rng = new Rng(3);
    const a = genomeFromTemplate({ size: 0.2 }, rng);
    const b = genomeFromTemplate({ size: 0.8 }, rng);
    let muts = 0;
    for (let k = 0; k < 200; k++) {
      const c = new Float32Array(GENE_COUNT);
      muts += inherit(a, b, rng, 0.08, c);
      for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    expect(muts).toBeGreaterThan(0);
  });

  it('distance is symmetric, zero on self, and handles hue wraparound', () => {
    const rng = new Rng(4);
    const a = genomeFromTemplate({}, rng);
    const b = genomeFromTemplate({ diet: 0.9 }, rng);
    expect(geneticDistance(a, a)).toBe(0);
    expect(geneticDistance(a, b)).toBeCloseTo(geneticDistance(b, a), 6);
    const h1 = Float32Array.from(a); h1[G.hue] = 0.02;
    const h2 = Float32Array.from(a); h2[G.hue] = 0.98;
    const h3 = Float32Array.from(a); h3[G.hue] = 0.5;
    expect(geneticDistance(h1, h2)).toBeLessThan(geneticDistance(h1, h3));
  });
});

describe('speciation', () => {
  it('splits two well-separated clusters into parent and child species', () => {
    const rng = new Rng(9);
    const world = makeWorld();
    const reg = new SpeciesRegistry();
    const base = genomeFromTemplate({ diet: 0.1, size: 0.3, speed: 0.3 }, rng, 0);
    const sp = reg.create(rng, Array.from(base), -1, 0, 'primordial');
    const creatures: Creature[] = [];
    let id = 1;
    for (let k = 0; k < 40; k++) {
      creatures.push(new Creature(id++, genomeFromTemplate({ diet: 0.1, size: 0.3, speed: 0.3 }, rng, 0.02), 10, 10, sp.id, 0));
      creatures.push(new Creature(id++, genomeFromTemplate({ diet: 0.75, size: 0.8, speed: 0.8, aggression: 0.9 }, rng, 0.02), 12, 10, sp.id, 1));
    }
    const res = reg.speciate(creatures, world, rng, 5000);
    expect(res.length).toBe(1);
    expect(res[0].child.parentId).toBe(sp.id);
    const ids = new Set(creatures.map((c) => c.speciesId));
    expect(ids.size).toBe(2);
    expect(res[0].members.length).toBe(40);
  });

  it('does not split a single homogeneous population', () => {
    const rng = new Rng(10);
    const reg = new SpeciesRegistry();
    const sp = reg.create(rng, Array.from(genomeFromTemplate({}, rng, 0)), -1, 0, 'primordial');
    const cs = Array.from({ length: 80 }, (_, k) => new Creature(k + 1, genomeFromTemplate({}, rng, 0.04), 5, 5, sp.id, 0));
    expect(reg.speciate(cs, makeWorld(), rng, 5000)).toHaveLength(0);
  });

  it('marks an empty species extinct with its tick', () => {
    const rng = new Rng(11);
    const reg = new SpeciesRegistry();
    const sp = reg.create(rng, Array.from(genomeFromTemplate({}, rng, 0)), -1, 0, 'primordial');
    const extinct = reg.refresh([], 777);
    expect(extinct.map((s) => s.id)).toContain(sp.id);
    expect(reg.get(sp.id)!.extinctTick).toBe(777);
  });
});
