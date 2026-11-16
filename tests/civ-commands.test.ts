import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { getScenario, ScenarioConfig } from '../src/engine/scenarios';
import { TECHS } from '../src/engine/civ/tech';
import { TICKS_PER_DAY } from '../src/engine/constants';

function small(id: string): ScenarioConfig {
  const sc = structuredClone(getScenario(id)!);
  sc.world = { ...sc.world, width: 128, height: 80 };
  return sc;
}

describe('civilization', () => {
  it('forms tribes and settlements in the Civilization scenario', () => {
    const sim = Simulation.create(small('civilization'), 'civ-1');
    for (let i = 0; i < TICKS_PER_DAY * 10; i++) sim.step();
    expect(sim.civ.tribes.length).toBeGreaterThanOrEqual(1);
    expect(sim.civ.settlements.length).toBeGreaterThanOrEqual(1);
    const t = sim.civ.tribes[0];
    const view = sim.civ.tribeView(sim, t);
    expect(view.name.length).toBeGreaterThan(0);
  });

  it('researches techs only after their prerequisites', () => {
    const sim = Simulation.create(small('civilization'), 'civ-2');
    for (let i = 0; i < TICKS_PER_DAY * 30; i++) sim.step();
    for (const t of sim.civ.tribes) {
      t.techs.forEach((id, idx) => {
        const def = TECHS.find((d) => d.id === id)!;
        for (const r of def.requires) expect(t.techs.indexOf(r)).toBeLessThan(idx);
      });
    }
  });
});

describe('god commands', () => {
  it('spawn on ocean snaps to land', () => {
    const sim = Simulation.create(small('primordial'), 'cmd-1');
    const w = sim.world;
    let ox = 0, oy = 0;
    for (let i = 0; i < w.size; i++) if (w.biome[i] === 0) { ox = (i % w.width) + 0.5; oy = Math.floor(i / w.width) + 0.5; break; }
    const before = sim.creatures.length;
    sim.queueCommand({ type: 'spawn', x: ox, y: oy, count: 5, template: 'grazer' });
    sim.step(); sim.step();
    const spawned = sim.creatures.slice(-5);
    expect(sim.creatures.length).toBeGreaterThanOrEqual(before + 5 - 2);
    for (const c of spawned) expect(w.isLand(w.tileAt(c.x, c.y))).toBe(true);
  });

  it('smite removes creatures in the radius only', () => {
    const sim = Simulation.create(small('primordial'), 'cmd-2');
    sim.step();
    const c = sim.creatures[0];
    const inside = sim.creatures.filter((o) => Math.hypot(o.x - c.x, o.y - c.y) <= 3).map((o) => o.id);
    const outside = sim.creatures.filter((o) => Math.hypot(o.x - c.x, o.y - c.y) > 6).map((o) => o.id);
    sim.queueCommand({ type: 'smite', x: c.x, y: c.y, radius: 3 });
    sim.step();
    for (const id of inside) expect(sim.byId.has(id)).toBe(false);
    const survivors = outside.filter((id) => sim.byId.has(id)).length;
    expect(survivors).toBeGreaterThan(outside.length * 0.95);
  });

  it('earthquake changes heights in its radius only', () => {
    const sim = Simulation.create(small('primordial'), 'cmd-3');
    const w = sim.world;
    const before = w.elevation.slice();
    const x = 64, y = 40;
    sim.queueCommand({ type: 'earthquake', x, y, magnitude: 8 });
    sim.step();
    let changedInside = 0, changedOutside = 0;
    for (let i = 0; i < w.size; i++) {
      if (w.elevation[i] === before[i]) continue;
      const d = Math.hypot((i % w.width) - x, Math.floor(i / w.width) - y);
      if (d <= 6 + 8 * 2.2 + 1) changedInside++; else changedOutside++;
    }
    expect(changedInside).toBeGreaterThan(50);
    expect(changedOutside).toBe(0);
    expect(sim.events.events.some((e) => e.title.startsWith('Earthquake'))).toBe(true);
  });

  it('drought lowers rainfall for its duration', () => {
    const sim = Simulation.create(small('primordial'), 'cmd-4');
    const rain = sim.climate.effectiveRain();
    sim.queueCommand({ type: 'drought', days: 2 });
    sim.step();
    expect(sim.climate.effectiveRain()).toBeLessThan(rain * 0.5);
    for (let i = 0; i < TICKS_PER_DAY * 2 + 5; i++) sim.step();
    expect(sim.climate.effectiveRain()).toBeCloseTo(rain, 5);
  });

  it('setParam changes environment controls', () => {
    const sim = Simulation.create(small('primordial'), 'cmd-5');
    sim.queueCommand({ type: 'setParam', key: 'tempOffset', value: -7 });
    sim.queueCommand({ type: 'setParam', key: 'foodMult', value: 2 });
    sim.step();
    expect(sim.climate.tempOffset).toBe(-7);
    expect(sim.settings.foodMult).toBe(2);
  });
});
