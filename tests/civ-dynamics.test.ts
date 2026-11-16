/**
 * Civilization dynamics: goals, policies, stability and rebellion, capital loss, expansion by real
 * colonists, collapse with history preserved, objectives, determinism with commands, and save upgrades.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { updateStrategy, POLICY_DELAY } from '../src/engine/civ/strategy';
import { abandon } from '../src/engine/civ/settlements';
import { evaluateObjectives, initObjectives } from '../src/engine/objectives';
import { checkInvariants } from '../src/engine/invariants';
import { upgradeState } from '../src/engine/saveUpgrade';
import { isReadableVersion } from '../src/client/persistence';
import { TICKS_PER_DAY, TICKS_PER_YEAR, SAVE_VERSION } from '../src/engine/constants';
import { POLICY_KEYS } from '../src/engine/types';
import { civWorld, clone, run, residentsOf, sister, small, days } from './helpers';

let base: Simulation;
let baseSettlement = -1;

beforeAll(() => {
  const w = civWorld('m2-civ', 16);
  base = w.sim;
  baseSettlement = w.s.id;
}, 60000);

function fixture() {
  const sim = clone(base);
  const s = sim.civ.settlement(baseSettlement)!;
  return { sim, s, t: sim.civ.tribe(s.tribeId)! };
}

/** Move `n` residents of s into d (as if they had migrated), then let a civ pass refresh membership. */
function populate(sim: Simulation, s: ReturnType<typeof fixture>['s'], d: ReturnType<typeof fixture>['s'], n: number) {
  const t = sim.civ.tribe(s.tribeId)!;
  for (const c of residentsOf(sim, s).filter((c) => c.id !== t.leaderId).slice(0, n)) { c.homeId = d.id; c.x = d.x; c.y = d.y; }
  run(sim, 30 - (sim.tick % 30), false);
}

describe('goals and policies', () => {
  it('chooses three distinct competing priorities', () => {
    const { sim, t } = fixture();
    updateStrategy(sim, sim.civ, t);
    expect(t.goals).toHaveLength(3);
    expect(new Set(t.goals).size).toBe(3);
  });

  it('adopts a policy only after its delay, at a stability cost, and records it', () => {
    const { sim, t } = fixture();
    sim.queueCommand({ type: 'setPolicy', tribeId: t.id, key: 'agriculture', value: 1 });
    sim.step();
    expect(t.policies.agriculture).toBe(0);
    expect(t.pendingPolicies.map((p) => p.key)).toContain('agriculture');
    expect(sim.civ.tribeView(sim, t).pendingPolicies).toHaveLength(1);
    const stab = t.stability;
    sim.tick += POLICY_DELAY + 1;
    t.stability = stab;
    updateStrategy(sim, sim.civ, t);
    expect(t.policies.agriculture).toBe(1);
    expect(t.pendingPolicies).toHaveLength(0);
    expect(t.policyHistory.at(-1)).toMatchObject({ key: 'agriculture', value: 1 });
    expect(sim.events.events.some((e) => e.title === 'New policy' && e.tribeId === t.id)).toBe(true);
  });

  it('clamps policy values and ignores no-op changes', () => {
    const { sim, t } = fixture();
    for (const k of POLICY_KEYS) sim.queueCommand({ type: 'setPolicy', tribeId: t.id, key: k, value: 0 });
    sim.queueCommand({ type: 'setPolicy', tribeId: t.id, key: 'military', value: 7 });
    sim.step();
    expect(t.pendingPolicies).toEqual([expect.objectContaining({ key: 'military', value: 1 })]);
  });
});

describe('stability, rebellion and capitals', () => {
  it('lets a distant, discontented town break away into a successor state with its people and history', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    populate(sim, s, d, 9);
    expect(d.population).toBeGreaterThanOrEqual(6);
    t.capitalId = s.id;
    t.stability = 0.05;
    t.lowStabilitySince = 0; // unstable since the dawn of this (young) world: well past the 8-day threshold
    expect(sim.tick).toBeGreaterThan(TICKS_PER_DAY * 8);
    t.lastSecession = -1e9;
    t.recentLossTick = sim.tick; // a recent loss keeps the target low
    const tribes = sim.civ.tribes.length;
    updateStrategy(sim, sim.civ, t);
    expect(sim.civ.tribes.length).toBe(tribes + 1);
    const nt = sim.civ.tribes[sim.civ.tribes.length - 1];
    expect(nt.parentTribeId).toBe(t.id);
    expect(t.successors).toContain(nt.id);
    expect(d.tribeId).toBe(nt.id);
    expect(nt.settlementIds).toEqual([d.id]);
    expect(t.settlementIds).not.toContain(d.id);
    expect(residentsOf(sim, d).every((c) => c.tribeId === nt.id)).toBe(true);
    expect(d.eras.at(-1)).toMatchObject({ how: 'seceded', tribeId: nt.id });
    expect(d.eras.at(-2)!.end).not.toBeNull();
    expect(sim.events.events.some((e) => (e.title === 'Rebellion' || e.title === 'Civil war') && e.settlementId === d.id)).toBe(true);
    expect(checkInvariants(sim, true)).toEqual([]);
    run(sim, days(1));
  });

  it('chooses a new capital when the old one is lost, with a causal event', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    populate(sim, s, d, 6);
    t.capitalId = s.id;
    const loss = abandon(sim, sim.civ, s, 'a test', -1)!;
    updateStrategy(sim, sim.civ, t);
    expect(t.capitalId).toBe(d.id);
    const ev = sim.events.events.find((e) => e.title === 'Capital lost' && e.tribeId === t.id)!;
    expect(ev).toBeTruthy();
    expect(ev.causeId).toBe(loss.id);
    expect(t.capitalLostTick).toBe(sim.tick);
  });

  it('collapses when its people are gone, keeping its towns as inspectable ruins', () => {
    const { sim, t } = fixture();
    const towns = t.settlementIds.slice();
    for (const c of sim.creatures.filter((c) => c.tribeId === t.id)) sim.kill(c, 'test');
    run(sim, 60);
    expect(t.collapsed).toBe(true);
    for (const id of towns) {
      const s = sim.civ.settlementById.get(id)!;
      expect(s.destroyed).toBe(true);
      expect(s.eras.at(-1)!.end).not.toBeNull();
      expect(sim.civ.settlementDetail(sim, id)?.tribeName).toBe(t.name);
    }
  });
});

describe('expansion', () => {
  it('expands only by sending real colonists, never by spawning a town', () => {
    // Find (deterministically) a small world with room to expand into.
    let found: ReturnType<typeof civWorld> | null = null;
    for (const seed of ['m2-civ', 'm2-exp-1', 'm2-exp-2', 'm2-exp-3', 'm2-exp-4']) {
      const w = seed === 'm2-civ' ? { sim: clone(base), s: base.civ.settlement(baseSettlement)!, t: base.civ.tribe(base.civ.settlement(baseSettlement)!.tribeId)! } : civWorld(seed, 16);
      const probe = clone(w.sim);
      const ps = probe.civ.settlement(w.s.id)!;
      if (probe.civ.findSite(probe, probe.civ.tribe(ps.tribeId)!, ps.x, ps.y, 12, 28, true)) { found = { sim: w.sim, s: w.sim.civ.settlement(w.s.id)!, t: w.sim.civ.tribe(w.s.tribeId)! }; break; }
    }
    expect(found).toBeTruthy();
    const { sim, s, t } = found!;
    run(sim, 30 - (sim.tick % 30), false); // one civilization pass, as in the live loop, rebuilds who lives where
    sim.tick = Math.floor(sim.tick / TICKS_PER_YEAR) * TICKS_PER_YEAR + TICKS_PER_YEAR + 200; // spring
    t.policies.expansion = 1;
    t.lastExpansion = -1e9;
    t.population = Math.max(t.population, 30);
    s.wood = Math.max(s.wood, 10);
    s.econ.nourishment = 0.8;
    const towns = sim.civ.settlements.length;
    for (const c of residentsOf(sim, s)) { c.energy = c.maxEnergy; c.hydration = 1; }
    updateStrategy(sim, sim.civ, t);
    expect(sim.civ.settlements.length).toBe(towns);
    const g = sim.civ.groups.find((x) => x.tribeId === t.id && x.kind === 'colonist');
    expect(g).toBeTruthy();
    expect(g!.members.length).toBeGreaterThanOrEqual(6);
    expect(residentsOf(sim, s).length).toBeGreaterThanOrEqual(6);
    expect(checkInvariants(sim)).toEqual([]);
  });
});

describe('objectives', () => {
  it('are absent in sandbox worlds and evaluated from real state in scenarios that define them', () => {
    const sandbox = Simulation.create(small('primordial'), 'obj-0');
    expect(sandbox.objectives).toEqual([]);
    const { sim } = fixture();
    expect(sim.objectives.length).toBeGreaterThan(0);
    sim.objectives = initObjectives(sim, [{ kind: 'settlementPopulation', label: 'Grow a town', params: { count: 5 } }, { kind: 'resettleRuin', label: 'Resettle' }]);
    evaluateObjectives(sim);
    expect(sim.objectives[0].status).toBe('complete');
    expect(sim.objectives[1].status).toBe('active');
    expect(sim.events.events.at(-1)!.title).toBe('Objective achieved');
  });
});

describe('determinism and persistence', () => {
  it('is deterministic with god commands and policy changes', () => {
    const a = clone(base), b = clone(base);
    const t = a.civ.activeTribes()[0];
    const s = a.civ.settlement(t.settlementIds[0])!;
    for (const sim of [a, b]) {
      sim.queueCommand({ type: 'setPolicy', tribeId: t.id, key: 'expansion', value: 1 });
      sim.queueCommand({ type: 'earthquake', x: s.x + 3, y: s.y, magnitude: 6 });
    }
    for (let i = 0; i < days(4); i++) { a.step(); b.step(); }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(JSON.stringify(a.civ.serialize())).toBe(JSON.stringify(b.civ.serialize()));
  });

  it('upgrades a version-3 save instead of discarding it', () => {
    const sim = clone(base);
    const state = structuredClone(sim.serialize()) as any;
    // Recreate the v3 shape: tribe-wide stores, a single building counter, no migration or strategy fields.
    state.version = 3;
    for (const t of state.civ.tribes) {
      t.stock = { food: 30, wood: 12, stone: 0, ore: 0 };
      for (const k of ['capitalId', 'stability', 'goals', 'policies', 'pendingPolicies', 'policyHistory', 'successors', 'events']) delete t[k];
    }
    state.civ.settlements = state.civ.settlements.map((s: any) => ({
      id: s.id, tribeId: s.tribeId, name: s.name, x: s.x, y: s.y, tier: s.tier, founded: s.founded, health: s.health,
      population: s.population, buildings: 8, walls: s.walls, farms: s.farms, destroyed: s.destroyed, destroyedTick: s.destroyedTick,
    }));
    for (const k of ['groups', 'nextGroupId', 'counters', 'lastLossEvent', 'borderReported']) delete state.civ[k];
    for (const c of state.creatures) { delete c.migrationId; delete c.lastMigrated; }
    delete state.objectives;
    expect(isReadableVersion(3)).toBe(true);
    expect(isReadableVersion(2)).toBe(false);
    expect(isReadableVersion(SAVE_VERSION + 1)).toBe(false);
    const up = Simulation.deserialize(upgradeState(state));
    expect(up.civ.settlements.length).toBe(sim.civ.settlements.length);
    const food = up.civ.settlements.filter((s) => !s.destroyed).reduce((a, s) => a + s.stock.food, 0);
    expect(food).toBeGreaterThan(0); // tribe stores were shared out, not lost
    for (const t of up.civ.activeTribes()) if (t.settlementIds.length) expect(t.settlementIds).toContain(t.capitalId);
    run(up, days(1));
    expect(() => upgradeState({ ...state, version: 2 })).toThrow(/Incompatible/);
  });
});
