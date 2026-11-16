import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { getScenario, ScenarioConfig } from '../src/engine/scenarios';
import { TICKS_PER_DAY } from '../src/engine/constants';

/** Smaller world so tests stay fast. */
function small(id = 'primordial'): ScenarioConfig {
  const sc = structuredClone(getScenario(id)!);
  sc.world = { ...sc.world, width: 128, height: 80 };
  sc.species = sc.species.map((s) => ({ ...s, count: Math.ceil(s.count / 2), herds: Math.max(1, Math.ceil((s.herds ?? 3) / 2)) }));
  return sc;
}

describe('simulation', () => {
  it('is deterministic for a seed', () => {
    const a = Simulation.create(small(), 'det');
    const b = Simulation.create(small(), 'det');
    for (let i = 0; i < 1500; i++) { a.step(); b.step(); }
    expect(a.creatures.length).toBe(b.creatures.length);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('continues identically after serialize → deserialize', () => {
    const a = Simulation.create(small(), 'save');
    for (let i = 0; i < 800; i++) a.step();
    const state = structuredClone(a.serialize());
    const b = Simulation.deserialize(state);
    expect(b.creatures.length).toBe(a.creatures.length);
    for (let i = 0; i < 600; i++) { a.step(); b.step(); }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('has births and deaths and keeps the population in bounds', () => {
    const sim = Simulation.create(small(), 'life');
    const start = sim.creatures.length;
    for (let i = 0; i < TICKS_PER_DAY * 14; i++) sim.step();
    expect(sim.totalBirths).toBeGreaterThan(0);
    expect(sim.totalDeaths).toBeGreaterThan(0);
    expect(sim.creatures.length).toBeGreaterThan(start * 0.3);
    expect(sim.creatures.length).toBeLessThan(4000);
    expect(sim.maxGeneration).toBeGreaterThan(0);
  });

  it('survives total extinction and can be repopulated', () => {
    const sim = Simulation.create(small(), 'void');
    sim.queueCommand({ type: 'cull', percent: 100 });
    for (let i = 0; i < 300; i++) sim.step();
    expect(sim.creatures.length).toBe(0);
    const vegBefore = sim.lastVeg.total;
    for (let i = 0; i < 300; i++) sim.step();
    expect(sim.lastVeg.total).toBeGreaterThanOrEqual(vegBefore * 0.9);
    expect(sim.events.events.some((e) => e.title === 'Silence')).toBe(true);
    sim.queueCommand({ type: 'introduceSpecies', template: 'grazer', count: 20 });
    sim.step(); sim.step();
    expect(sim.creatures.length).toBe(20);
    expect(sim.summary().population).toBe(20);
  });

  it('inspect returns an archived record for a dead creature', () => {
    const sim = Simulation.create(small(), 'ghost');
    sim.step();
    const c = sim.creatures[0];
    const id = c.id;
    expect(sim.creatureDetail(id)?.alive).toBe(true);
    sim.kill(c, 'testing');
    sim.step();
    const d = sim.creatureDetail(id);
    expect(d).not.toBeNull();
    expect(d!.alive).toBe(false);
    expect(d!.causeOfDeath).toBe('testing');
    expect(d!.name).toBe(c.name);
  });

  it('packs render frames with 12 floats per creature', () => {
    const sim = Simulation.create(small(), 'frame');
    const buf = new Float32Array(sim.creatures.length * 12 + 12);
    const n = sim.packFrame(buf);
    expect(n).toBe(sim.creatures.length);
    expect(buf[0]).toBe(sim.creatures[0].id);
    expect(buf[1]).toBeCloseTo(sim.creatures[0].x, 4);
  });
});
