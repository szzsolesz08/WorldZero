/**
 * Settlement lifecycle: hysteresis, minimum durations, abandonment, decay by material, ruins,
 * resettlement and fading territorial claims.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Simulation } from '../src/engine/simulation';
import { evaluateLifecycle, deteriorate, abandon, residualClaim, PASSES_PER_DAY, type Settlement } from '../src/engine/civ/settlements';
import { CIV_INTERVAL } from '../src/engine/civ/civilization';
import { checkInvariants } from '../src/engine/invariants';
import { TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON } from '../src/engine/constants';
import { civWorld, clone, run, residentsOf, days } from './helpers';

let base: Simulation;
let baseSettlement = -1;

beforeAll(() => {
  const w = civWorld('m2-life');
  base = w.sim;
  baseSettlement = w.s.id;
}, 60000);

function fixture() {
  const sim = clone(base);
  const s = sim.civ.settlement(baseSettlement)!;
  return { sim, s, t: sim.civ.tribe(s.tribeId)! };
}

/** Hold a settlement's economy at fixed values and run its lifecycle evaluation pass by pass. */
function holdAt(sim: Simulation, s: Settlement, prosperity: number, passes: number): string[] {
  const seen: string[] = [];
  for (let k = 0; k < passes; k++) {
    sim.tick += CIV_INTERVAL;
    s.econ.prosperity = prosperity;
    s.econ.reserveDays = 4;
    s.econ.balance = 0;
    s.popHistory = s.popHistory.map(() => s.population);
    evaluateLifecycle(sim, sim.civ, s);
    seen.push(s.state);
  }
  return seen;
}

describe('settlement lifecycle', () => {
  it('enters crisis only after the minimum duration', () => {
    const { sim, s } = fixture();
    s.state = 'stable'; s.pending = null;
    const passesPerDay = PASSES_PER_DAY;
    const early = holdAt(sim, s, -0.7, Math.floor(passesPerDay * 0.9));
    expect(early.every((x) => x === 'stable')).toBe(true);
    expect(s.pending).toBe('crisis');
    holdAt(sim, s, -0.7, passesPerDay);
    expect(s.state).toBe('crisis');
    expect(s.crisisSince).toBeGreaterThan(0);
  });

  it('uses hysteresis: conditions that would not start a crisis do not end one either', () => {
    const { sim, s } = fixture();
    s.state = 'stable'; s.pending = null;
    holdAt(sim, s, -0.35, PASSES_PER_DAY * 4);
    expect(s.state).not.toBe('crisis'); // -0.35 is above the entry threshold
    s.state = 'crisis'; s.pending = null;
    holdAt(sim, s, -0.35, PASSES_PER_DAY * 4);
    expect(s.state).toBe('crisis'); // ...but below the exit threshold
  });

  it('does not oscillate when conditions flicker around a threshold', () => {
    const { sim, s } = fixture();
    s.state = 'stable'; s.pending = null;
    let changes = 0, prev = s.state;
    for (let k = 0; k < PASSES_PER_DAY * 12; k++) {
      holdAt(sim, s, k % 2 ? -0.2 : 0.0, 1);
      if (s.state !== prev) { changes++; prev = s.state; }
    }
    expect(changes).toBe(0);
  });

  it('is abandoned once nobody lives there, keeping its identity and history', () => {
    const { sim, s, t } = fixture();
    const name = s.name, founded = s.founded, peak = s.peak, events = s.events.length;
    for (const c of residentsOf(sim, s)) sim.kill(c, 'test');
    for (let d = 0; d < 8 && !s.destroyed; d++) run(sim, days(1));
    expect(s.destroyed).toBe(true);
    expect(s.state === 'abandoned' || s.state === 'ruins').toBe(true);
    expect(t.settlementIds).not.toContain(s.id);
    expect(residentsOf(sim, s)).toHaveLength(0);
    expect(s.name).toBe(name);
    expect(s.founded).toBe(founded);
    expect(s.peak).toBeGreaterThanOrEqual(peak);
    expect(s.events.length).toBeGreaterThan(events);
    expect(s.eras[s.eras.length - 1].end).not.toBeNull();
    for (const f of s.oldFarms) expect(sim.world.farm[f]).toBe(0);
  });

  it('stops all production, work and political status when abandoned', () => {
    const { sim, s, t } = fixture();
    const former = residentsOf(sim, s);
    t.capitalId = s.id;
    abandon(sim, sim.civ, s, 'a test', -1);
    expect(former.every((c) => c.homeId !== s.id)).toBe(true);
    const stock = { ...s.stock };
    run(sim, days(2));
    expect(s.stock.food).toBeLessThanOrEqual(stock.food); // only spoils, never grows
    expect(s.stock.wood).toBeLessThanOrEqual(stock.wood);
    expect(s.population).toBe(0);
    expect(t.capitalId === s.id && !t.collapsed).toBe(false);
  });

  it('decays by material: timber within years, stone and walls over decades, fields within months', () => {
    const { sim, s } = fixture();
    abandon(sim, sim.civ, s, 'a test', -1, 'settlement', false);
    Object.assign(s, { wood: 10, stone: 10, woodAtAbandon: 10, walls: true, wallCondition: 1, farmCondition: 1, state: 'abandoned' });
    const passes = TICKS_PER_YEAR / CIV_INTERVAL;
    for (let k = 0; k < passes; k++) { sim.tick += CIV_INTERVAL; deteriorate(sim, sim.civ, s); }
    expect(s.wood).toBeLessThan(5);
    expect(s.stone).toBeGreaterThan(9.5);
    expect(s.wallCondition).toBeGreaterThan(0.9);
    expect(s.farmCondition).toBeLessThan(0.05);
    expect(s.state).toBe('ruins');
    expect(s.reclaimed).toBe(false); // the stone still marks the place
  });

  it('turns to reclaimed land only when nothing is left standing', () => {
    const { sim, s } = fixture();
    abandon(sim, sim.civ, s, 'a test', -1, 'settlement', false);
    Object.assign(s, { wood: 3, stone: 0, woodAtAbandon: 3, walls: false, wallCondition: 0, state: 'abandoned' });
    for (let k = 0; k < (TICKS_PER_YEAR * 4) / CIV_INTERVAL && !s.reclaimed; k++) { sim.tick += CIV_INTERVAL; deteriorate(sim, sim.civ, s); }
    expect(s.reclaimed).toBe(true);
    expect(s.name.length).toBeGreaterThan(0); // the record survives even then
  });

  it('can be resettled, reusing what stands and recording a new era', () => {
    const { sim, s, t } = fixture();
    abandon(sim, sim.civ, s, 'a test', -1, 'settlement', false);
    s.stone = 12; s.wood = 5;
    sim.tick += TICKS_PER_DAY * 10;
    const colonists = sim.creatures.filter((c) => c.tribeId === t.id && c.homeId >= 0).slice(0, 8);
    for (const c of colonists) { const h = sim.civ.settlement(c.homeId); if (h) h.population--; }
    const eras = s.eras.length;
    const r = sim.civ.establish(sim, t, s.x, s.y, colonists, null, 'colonized', -1, s.id);
    expect(r.id).toBe(s.id);
    expect(s.destroyed).toBe(false);
    expect(s.eras).toHaveLength(eras + 1);
    expect(s.eras[eras].how).toBe('resettled');
    expect(s.stone).toBe(12); // stonework reused as is
    expect(s.wood).toBeCloseTo(5 * 0.8 + 2);
    expect(t.settlementIds).toContain(s.id);
    expect(sim.civ.counters.resettled).toBeGreaterThan(0);
    expect(checkInvariants(sim, true)).toEqual([]);
  });

  it('loses its territorial claim gradually after abandonment', () => {
    const { sim, s } = fixture();
    abandon(sim, sim.civ, s, 'a test', -1, 'settlement', false);
    expect(residualClaim(sim, s)).toBeCloseTo(1, 1);
    sim.tick += Math.round(TICKS_PER_SEASON / 2);
    expect(residualClaim(sim, s)).toBeGreaterThan(0.3);
    expect(residualClaim(sim, s)).toBeLessThan(0.7);
    sim.tick += TICKS_PER_SEASON;
    expect(residualClaim(sim, s)).toBe(0);
  });
});
