import { expect } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { getScenario, ScenarioConfig } from '../src/engine/scenarios';
import { CIV_INTERVAL, type Tribe } from '../src/engine/civ/civilization';
import type { Settlement } from '../src/engine/civ/settlements';
import { checkInvariants } from '../src/engine/invariants';
import { TICKS_PER_DAY } from '../src/engine/constants';

/** Smaller world so tests stay fast. */
export function small(id: string, w = 128, h = 80): ScenarioConfig {
  const sc = structuredClone(getScenario(id)!);
  sc.world = { ...sc.world, width: w, height: h };
  return sc;
}

/** Independent deep copy of a running simulation (through the real save path). */
export function clone(sim: Simulation): Simulation {
  return Simulation.deserialize(structuredClone(sim.serialize()));
}

/** Step whole ticks; after every civilization pass, assert the population-integrity invariants. */
export function run(sim: Simulation, ticks: number, strict = true): void {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (sim.tick % CIV_INTERVAL === 0) {
      const errs = checkInvariants(sim, strict);
      expect(errs, `tick ${sim.tick}`).toEqual([]);
    }
  }
}

export const days = (n: number) => Math.round(n * TICKS_PER_DAY);

/** Run a small Civilization world until some tribe holds a settlement with at least `minPop` residents. */
export function civWorld(seed = 'm2-base', minPop = 12): { sim: Simulation; t: Tribe; s: Settlement } {
  const sim = Simulation.create(small('civilization'), seed);
  for (let d = 0; d < 40; d++) {
    run(sim, TICKS_PER_DAY, false);
    const s = sim.civ.activeSettlements().filter((x) => x.population >= minPop && x.state !== 'founded').sort((a, b) => b.population - a.population)[0];
    if (s && d >= 8) return { sim, t: sim.civ.tribe(s.tribeId)!, s };
  }
  throw new Error('no established settlement formed');
}

export function residentsOf(sim: Simulation, s: Settlement) {
  return sim.creatures.filter((c) => c.alive && c.homeId === s.id);
}

/** Found a second, empty settlement of the same people near `s` (a valid site), for migration tests. */
export function sister(sim: Simulation, t: Tribe, s: Settlement): Settlement {
  let site: { x: number; y: number } | null = sim.civ.findSite(sim, t, s.x, s.y, 10, 30, false);
  // Fall back to the nearest valid site on a grid (tests need a sister town, not the best one).
  for (let r = 10; !site && r <= 45; r += 3) {
    for (let a = 0; a < 24 && !site; a++) {
      const x = s.x + Math.cos((a / 24) * Math.PI * 2) * r, y = s.y + Math.sin((a / 24) * Math.PI * 2) * r;
      if (sim.civ.siteValid(sim, t, x, y)) site = { x, y };
    }
  }
  if (!site) throw new Error('no site for a sister settlement');
  const d = sim.civ.foundSettlement(sim, t, site.x, site.y, s, 'colonized', -1);
  d.wood = 40; // room for newcomers
  return d;
}
