/**
 * Migration: real creatures travelling as households, destination scoring and its safety rules,
 * physical travel, deaths on the road, stranding, refugees, colonists and persistence mid-journey.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Simulation } from '../src/engine/simulation';
import { households, destinationScore, createGroup, planMigration, updateGroups, MIN_VIABLE } from '../src/engine/civ/migration';
import { checkInvariants } from '../src/engine/invariants';
import { TICKS_PER_DAY } from '../src/engine/constants';
import { dist2d } from '../src/engine/mathutil';
import { civWorld, clone, run, residentsOf, sister, days } from './helpers';

let base: Simulation;
let baseSettlement = -1;

beforeAll(() => {
  const w = civWorld('m2-move', 16);
  base = w.sim;
  baseSettlement = w.s.id;
}, 60000);

function fixture() {
  const sim = clone(base);
  const s = sim.civ.settlement(baseSettlement)!;
  const t = sim.civ.tribe(s.tribeId)!;
  return { sim, s, t };
}

/** One household of adults and children, moving from s to d as an economic group. */
function sendFamily(sim: Simulation, s: ReturnType<typeof fixture>['s'], d: ReturnType<typeof fixture>['s']) {
  const t = sim.civ.tribe(s.tribeId)!;
  const hh = households(residentsOf(sim, s)).filter((h) => !h.some((c) => c.id === t.leaderId));
  const members = hh.slice(0, 2).flat();
  // Planning only sends households fit for the road; these tests are about the road itself.
  for (const c of members) { c.energy = c.maxEnergy; c.hydration = 1; c.health = c.maxHealth; }
  const g = createGroup(sim, sim.civ, { tribe: t, kind: 'economic', origin: s, dest: d, destX: d.x, destY: d.y, members, reason: 'overcrowding', causeId: -1, supplies: 40, wood: 0, suitability: 0.5, reservedAt: d.id });
  if (g) d.reserved += members.length;
  return { g: g!, members };
}

describe('households', () => {
  it('group each adult with their resident mate and young children, with nobody counted twice', () => {
    const { sim, s } = fixture();
    const res = residentsOf(sim, s);
    const hh = households(res);
    const seen = new Set<number>();
    for (const h of hh) {
      expect(h[0].mature).toBe(true);
      expect(h.filter((c) => c.mature).length).toBeLessThanOrEqual(2);
      for (const c of h) { expect(seen.has(c.id)).toBe(false); seen.add(c.id); }
      for (const k of h.filter((c) => !c.mature)) expect(h.some((p) => k.motherId === p.id || k.fatherId === p.id)).toBe(true);
    }
    expect(seen.size).toBeLessThanOrEqual(res.length);
  });
});

describe('destination scoring', () => {
  it('is normalised and prefers better places', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    s.econ.pressure = 0.8; d.econ.pressure = 0.1;
    d.econ.prosperity = 0.6; d.econ.reserveDays = 8; d.econ.security = 1; d.econ.employment = 1;
    const good = destinationScore(sim, sim.civ, t, s, d);
    expect(good).toBeGreaterThan(0);
    expect(good).toBeLessThanOrEqual(1);
    d.econ.prosperity = -0.6; d.econ.reserveDays = 0;
    expect(destinationScore(sim, sim.civ, t, s, d)).toBeLessThan(good);
  });

  it('rejects full destinations, places worse off than home, and recent back-flows', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    s.econ.pressure = 0.8; d.econ.pressure = 0.1;
    expect(destinationScore(sim, sim.civ, t, s, d)).toBeGreaterThan(-Infinity);
    d.reserved = 1000; // already promised to others: over capacity
    expect(destinationScore(sim, sim.civ, t, s, d)).toBe(-Infinity);
    d.reserved = 0;
    d.econ.pressure = 0.75; // no herding into a place nearly as troubled
    expect(destinationScore(sim, sim.civ, t, s, d)).toBe(-Infinity);
    d.econ.pressure = 0.1;
    s.recentFrom[d.id] = sim.tick; // people just came from there
    expect(destinationScore(sim, sim.civ, t, s, d)).toBe(-Infinity);
  });
});

describe('planning', () => {
  it('never drains a settlement below its viable minimum by choice, and books room at the destination', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    run(sim, 30, false); // refresh residents
    const before = residentsOf(sim, s).length;
    s.econ.pressure = 1; s.crisisSince = -1; s.state = 'declining'; s.lastEmigration = -1e9;
    d.econ.pressure = 0; d.econ.prosperity = 0.5; d.econ.reserveDays = 6;
    sim.tick = Math.ceil(sim.tick / 4800) * 4800 + 300; // spring: nobody waits for better weather
    const firstNew = sim.civ.nextGroupId;
    for (let k = 0; k < 6; k++) { s.lastEmigration = -1e9; planMigration(sim, sim.civ, t); }
    const after = residentsOf(sim, s).length;
    const leaving = sim.civ.groups.filter((g) => g.originId === s.id && g.id >= firstNew).reduce((a, g) => a + g.members.length, 0);
    expect(after + leaving).toBe(before);
    expect(after).toBeGreaterThanOrEqual(Math.min(before, MIN_VIABLE));
    expect(after).toBeGreaterThanOrEqual(Math.floor(before * 0.5));
    expect(d.reserved).toBe(sim.civ.groups.filter((g) => g.reservedAt === d.id).reduce((a, g) => a + g.size0, 0));
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('respects the per-creature cooldown: recent migrants do not move again by choice', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    run(sim, 30, false);
    for (const c of residentsOf(sim, s)) c.lastMigrated = sim.tick;
    s.econ.pressure = 1; s.crisisSince = -1; s.lastEmigration = -1e9;
    d.econ.pressure = 0;
    const firstNew = sim.civ.nextGroupId;
    planMigration(sim, sim.civ, t);
    expect(sim.civ.groups.filter((g) => g.originId === s.id && g.id >= firstNew && g.kind === 'economic')).toHaveLength(0);
  });
});

describe('travel', () => {
  it('moves real creatures (no copies), physically, and houses them on arrival', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    const totalBefore = sim.creatures.length;
    const { g, members } = sendFamily(sim, s, d);
    expect(g).toBeTruthy();
    for (const c of members) {
      expect(c.homeId).toBe(-1);
      expect(c.migrationId).toBe(g.id);
      expect(sim.byId.get(c.id)).toBe(c); // the very same creature
    }
    expect(sim.creatures.length).toBe(totalBefore);
    const leader = sim.byId.get(g.leaderId)!;
    const d0 = dist2d(leader.x - d.x, leader.y - d.y);
    expect(d0).toBeGreaterThan(5); // not already there: no teleporting
    let maxStep = 0, px = leader.x, py = leader.y;
    for (let i = 0; i < days(12) && sim.civ.group(g.id); i++) {
      run(sim, 1);
      const L = sim.byId.get(g.leaderId);
      if (L && L === leader) { maxStep = Math.max(maxStep, dist2d(L.x - px, L.y - py)); px = L.x; py = L.y; }
    }
    expect(maxStep).toBeLessThan(1.5); // walking pace, never a jump
    expect(sim.civ.group(g.id)).toBeUndefined();
    const alive = members.filter((c) => c.alive);
    const housed = alive.filter((c) => c.homeId === d.id);
    expect(housed.length + alive.filter((c) => c.homeId !== d.id && c.migrationId < 0).length).toBe(alive.length);
    expect(housed.length).toBeGreaterThan(0);
    // Its booking was released; anything still reserved belongs to other households on their way.
    expect(d.reserved).toBe(sim.civ.groups.filter((x) => x.reservedAt === d.id).reduce((a, x) => a + x.size0, 0));
  });

  it('records deaths on the road without losing or duplicating anyone', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    const { g, members } = sendFamily(sim, s, d);
    run(sim, 40);
    const victim = members.find((c) => c.alive && c.id !== g.leaderId)!;
    sim.kill(victim, 'test');
    run(sim, 30);
    if (sim.civ.group(g.id)) {
      expect(g.members).not.toContain(victim.id);
      expect(g.deaths).toBeGreaterThanOrEqual(1);
    }
    expect(sim.civ.counters.migrantDeaths).toBeGreaterThanOrEqual(1);
    // run() already checked strict counts at every civilization pass; between passes only structure is exact.
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('re-routes once when stalled, then strands the group instead of leaving it stuck forever', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    const { g, members } = sendFamily(sim, s, d);
    g.lastProgressTick = sim.tick - TICKS_PER_DAY * 30;
    updateGroups(sim, sim.civ);
    expect(g.rerouted).toBe(true);
    g.lastProgressTick = sim.tick - TICKS_PER_DAY * 30;
    const stranded = sim.civ.counters.stranded;
    updateGroups(sim, sim.civ);
    expect(sim.civ.group(g.id)).toBeUndefined();
    expect(sim.civ.counters.stranded).toBeGreaterThan(stranded);
    for (const c of members) { expect(c.migrationId).toBe(-1); expect(c.alive).toBe(true); expect(c.tribeId).toBe(t.id); }
    expect(d.reserved).toBe(sim.civ.groups.filter((x) => x.reservedAt === d.id).reduce((a, x) => a + x.size0, 0));
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('re-routes immediately when the destination is lost on the way', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    const { g } = sendFamily(sim, s, d);
    sim.civ.damageArea(sim, d.x, d.y, 3, 500, 'a test');
    expect(d.destroyed).toBe(true);
    updateGroups(sim, sim.civ);
    const still = sim.civ.group(g.id);
    if (still) expect(still.destId).not.toBe(d.id);
    expect(checkInvariants(sim)).toEqual([]);
  });
});

describe('refugees and colonists', () => {
  it('turns survivors of a destroyed town into refugees, linked to the disaster that caused it', () => {
    const { sim, s, t } = fixture();
    sister(sim, t, s).wood = 80;
    const residents = residentsOf(sim, s).length;
    const cause = sim.events.push({ tick: sim.tick, cat: 'disaster', level: 3, title: 'Test quake', text: '' });
    sim.civ.damageArea(sim, s.x, s.y, 4, 1000, 'a test quake', cause.id);
    expect(s.destroyed).toBe(true);
    const refugees = sim.civ.groups.filter((g) => g.kind === 'refugee' && g.originId === s.id);
    expect(refugees.length).toBeGreaterThan(0);
    const moving = refugees.reduce((a, g) => a + g.members.length, 0);
    const homeless = sim.creatures.filter((c) => c.tribeId === t.id && c.homeId < 0 && c.migrationId < 0).length;
    expect(moving).toBeGreaterThan(0);
    expect(moving).toBeLessThanOrEqual(residents + homeless);
    const lost = sim.events.events.find((e) => e.title === 'Settlement lost' && e.settlementId === s.id)!;
    expect(lost.causeId).toBe(cause.id);
    const flee = sim.events.events.find((e) => e.title.startsWith('Refugees flee') && e.settlementId === s.id);
    expect(flee?.causeId).toBe(lost.id);
    expect(checkInvariants(sim)).toEqual([]);
  });

  it('lets colonists found a new settlement only where they physically arrive, recording its parent', () => {
    const { sim, s, t } = fixture();
    const d0 = sister(sim, t, s);
    const site = { x: d0.x, y: d0.y };
    sim.civ.settlements = sim.civ.settlements.filter((x) => x !== d0); // keep the site, not the town
    sim.civ.settlementById.delete(d0.id);
    t.settlementIds = t.settlementIds.filter((id) => id !== d0.id);
    const members = households(residentsOf(sim, s)).filter((h) => !h.some((c) => c.id === t.leaderId)).slice(0, 3).flat();
    const towns = sim.civ.settlements.length;
    const g = createGroup(sim, sim.civ, { tribe: t, kind: 'colonist', origin: s, dest: null, destX: site.x, destY: site.y, members, reason: 'test', causeId: -1, supplies: 20, wood: 6, suitability: 0 })!;
    expect(sim.civ.settlements.length).toBe(towns); // nothing appears before they get there
    for (let i = 0; i < days(14) && sim.civ.group(g.id); i++) run(sim, 1);
    const founded = sim.civ.settlements.slice(towns).find((x) => x.parentId === s.id || x.eras.some((e) => e.how === 'colonized'));
    if (founded) {
      expect(dist2d(founded.x - site.x, founded.y - site.y)).toBeLessThan(12);
      expect(founded.parentId).toBe(s.id);
      expect(members.filter((c) => c.alive && c.homeId === founded.id).length).toBeGreaterThan(0);
    } else {
      expect(sim.civ.counters.failed + sim.civ.counters.stranded).toBeGreaterThan(0);
    }
  });
});

describe('persistence', () => {
  it('saves and restores a world mid-journey and continues identically', () => {
    const { sim, s, t } = fixture();
    const d = sister(sim, t, s);
    const { g } = sendFamily(sim, s, d);
    run(sim, 200);
    const copy = clone(sim);
    const cg = copy.civ.group(g.id);
    expect(cg).toBeTruthy();
    expect(cg!.members).toEqual(sim.civ.group(g.id)!.members);
    for (const id of cg!.members) expect(copy.byId.get(id)!.migrationId).toBe(g.id);
    for (let i = 0; i < 900; i++) { sim.step(); copy.step(); }
    expect(copy.stateHash()).toBe(sim.stateHash());
    expect(JSON.stringify(copy.civ.serialize())).toBe(JSON.stringify(sim.civ.serialize()));
    expect(checkInvariants(copy, false)).toEqual([]);
  });
});
