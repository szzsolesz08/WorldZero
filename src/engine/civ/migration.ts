/**
 * Household migration between settlements, refugees and colonists.
 *
 * Population stays in one representation: creatures. A migrating creature has homeId = -1 and
 * migrationId = group id; the group only records who travels together, where to, and why.
 * Groups walk the world on A* waypoints; members eat carried supplies and can die on the road.
 */
import type { Simulation } from '../simulation';
import type { Creature } from '../creatures/creature';
import type { CivManager, Tribe } from './civilization';
import { Settlement, housingOf, settlementEvent, PASSES_PER_DAY } from './settlements';
import { findPath } from '../pathfind';
import { PLANT_ENERGY, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants';
import type { MigrationGroupView, MigrationKind } from '../types';
import { dist2d } from '../mathutil';

export interface MigrationGroup {
  id: number;
  tribeId: number;
  /** Tribe that will take refugees in, when they flee to an ally. */
  hostTribeId: number;
  kind: MigrationKind;
  originId: number;
  originX: number;
  originY: number;
  destId: number;
  destX: number;
  destY: number;
  members: number[];
  leaderId: number;
  reason: string;
  causeId: number;
  started: number;
  supplies: number;
  wood: number;
  waypoints: number[];
  wp: number;
  startDist: number;
  bestDist: number;
  lastProgressTick: number;
  rerouted: boolean;
  suitability: number;
  deaths: number;
  size0: number;
  reservedAt: number;
}

/** Settlements never send away people below this many residents unless they are failing. */
export const MIN_VIABLE = 6;
/** Configurable destination weights (normalised factors, summing to 1). */
export const DEST_WEIGHTS = { distance: 0.2, housing: 0.2, food: 0.2, security: 0.12, prosperity: 0.12, jobs: 0.06, stability: 0.1 };
/** Voluntary migrants only consider towns within this many tiles (a few days on foot). */
const MAX_DIST = 55;
const CREATURE_COOLDOWN = TICKS_PER_YEAR;
const ROUTE_BLOCK = TICKS_PER_DAY * 20;
const MAX_TRAVEL = TICKS_PER_DAY * 25;
const STALL = TICKS_PER_DAY * 4;
/** Within this distance of a town's centre a group has arrived (towns have extent). */
const ARRIVE_TOWN = 5;
const ARRIVE_SITE = 4;

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Households: a mature adult, their resident mate, and their immature resident children. */
export function households(residents: Creature[]): Creature[][] {
  const sorted = residents.slice().sort((a, b) => a.id - b.id);
  const taken = new Set<number>();
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const out: Creature[][] = [];
  for (const c of sorted) {
    if (taken.has(c.id) || !c.mature) continue;
    const h = [c];
    taken.add(c.id);
    const mate = c.mateId >= 0 ? byId.get(c.mateId) : undefined;
    if (mate && !taken.has(mate.id) && mate.mature) { h.push(mate); taken.add(mate.id); }
    for (const k of sorted) {
      if (taken.has(k.id) || k.mature) continue;
      if (h.some((p) => k.motherId === p.id || k.fatherId === p.id)) { h.push(k); taken.add(k.id); }
    }
    out.push(h);
  }
  return out;
}

function freeHousing(s: Settlement, overflow = 1.15): number {
  return housingOf(s) * overflow - s.population - s.reserved;
}

function reachable(sim: Simulation, civ: CivManager, t: Tribe, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const w = sim.world;
  const la = w.landmass[w.tileAt(a.x, a.y)], lb = w.landmass[w.tileAt(b.x, b.y)];
  return (la >= 0 && la === lb) || civ.hasTech(t.id, 'sailing');
}

/** Normalised suitability of a destination for migrants from `origin` (or -Infinity if unsuitable). */
export function destinationScore(sim: Simulation, civ: CivManager, t: Tribe, origin: Settlement, d: Settlement, host: Tribe = t): number {
  if (d.destroyed || d.id === origin.id) return -Infinity;
  const dist = dist2d(d.x - origin.x, d.y - origin.y);
  if (dist > MAX_DIST) return -Infinity;
  const free = freeHousing(d);
  if (free < 2) return -Infinity;
  if (d.econ.pressure > origin.econ.pressure - 0.15) return -Infinity;
  // Anti-oscillation: no flows back along a route that was used recently.
  const back = origin.recentFrom[d.id];
  if (back !== undefined && sim.tick - back < ROUTE_BLOCK) return -Infinity;
  if (!reachable(sim, civ, t, origin, d)) return -Infinity;
  const W = DEST_WEIGHTS;
  return W.distance * (1 - dist / MAX_DIST) + W.housing * Math.min(1, free / 8) + W.food * clamp(d.econ.reserveDays / 8, 0, 1) +
    W.security * d.econ.security + W.prosperity * (d.econ.prosperity + 1) / 2 + W.jobs * d.econ.employment + W.stability * host.stability;
}

/** Foreign towns that would take in migrants: not at war, open (or allied) hosts. Internal destinations always come first. */
function foreignDestinations(sim: Simulation, civ: CivManager, t: Tribe, origin: Settlement): { d: Settlement; score: number; host: number }[] {
  const out: { d: Settlement; score: number; host: number }[] = [];
  for (const o of civ.tribes) {
    if (o.collapsed || o.id === t.id) continue;
    const r = civ.rel(t.id, o.id);
    if (r && (r.status === 'war' || r.value < -30)) continue;
    const allied = r?.status === 'alliance';
    if (!allied && o.culture.openness < 0.35) continue;
    for (const sid of o.settlementIds) {
      const d = civ.settlement(sid);
      if (!d) continue;
      const sc = destinationScore(sim, civ, t, origin, d, o);
      if (sc === -Infinity) continue;
      // Strangers are less attractive than kin; allies and open cultures less so.
      out.push({ d, host: o.id, score: sc - 0.12 + (allied ? 0.06 : 0) + 0.06 * o.culture.openness });
    }
  }
  return out;
}

function fitToTravel(c: Creature): boolean {
  if (!c.mature) return c.energy > c.maxEnergy * 0.4;
  return c.energy > c.maxEnergy * 0.55 && c.hydration > 0.5 && c.health > c.maxHealth * 0.6 && c.age < c.lifespan * 0.85;
}

function familyBonus(sim: Simulation, h: Creature[], d: Settlement): number {
  let n = 0;
  for (const c of h) for (const r of c.relations) {
    if (r.kind === 'friend' || r.kind === 'rival') continue;
    const o = sim.byId.get(r.id);
    if (o && o.homeId === d.id) n++;
  }
  return Math.min(0.18, n * 0.06);
}

/** Periodic migration planning for one tribe (called every few civ passes, staggered by tribe). */
export function planMigration(sim: Simulation, civ: CivManager, t: Tribe): void {
  const tick = sim.tick, rng = sim.rng;
  const winter = sim.climate.season(tick) === 3;
  const active = t.settlementIds.map((id) => civ.settlement(id)).filter((s): s is Settlement => !!s);
  // Homeless members far from any settlement walk home as a group.
  const homeless = civ.homeless.get(t.id) ?? [];
  if (homeless.length && active.length) {
    const byDest = new Map<number, Creature[]>();
    for (const c of homeless) {
      // After a failed journey, rest and forage a while before trying again.
      if (tick - c.lastMigrated < TICKS_PER_DAY * 6) continue;
      let best: Settlement | null = null, bd = Infinity;
      for (const s of active) {
        const d = dist2d(s.x - c.x, s.y - c.y);
        if (d < bd && reachable(sim, civ, t, c, s)) { bd = d; best = s; }
      }
      if (!best) continue;
      const list = byDest.get(best.id) ?? [];
      list.push(c);
      byDest.set(best.id, list);
    }
    for (const [sid, members] of byDest) {
      const d = civ.settlementById.get(sid)!;
      createGroup(sim, civ, { tribe: t, kind: 'economic', origin: null, dest: d, destX: d.x, destY: d.y, members, reason: 'returning home', causeId: -1, supplies: 0, wood: 0, suitability: 0 });
    }
  }
  if (!active.length) return;
  for (const s of active) {
    if (s.state === 'founded') continue;
    const push = s.econ.pressure;
    const crisisLong = s.crisisSince >= 0 && tick - s.crisisSince > TICKS_PER_DAY * 4;
    if (push < 0.3) continue;
    if (tick - s.lastEmigration < TICKS_PER_DAY * 2) continue;
    // Households wait for spring rather than set out into winter, unless their town is failing.
    if (!crisisLong && winter) continue;
    const res = civ.residents.get(s.id) ?? [];
    if (res.length < 3) continue;
    // Internal destinations first; foreign hosts only when no town of their own people will do.
    let scored: { d: Settlement; score: number; host: number }[] = [];
    for (const d of active) {
      const sc = destinationScore(sim, civ, t, s, d);
      if (sc > -Infinity) scored.push({ d, score: sc, host: t.id });
    }
    const foreign = scored.length === 0 && (push > 0.55 || crisisLong);
    if (foreign) scored = foreignDestinations(sim, civ, t, s);
    if (scored.length === 0) {
      // Nowhere to go: a failing town sends pioneers to found a new home (strategic site rules apply).
      if (crisisLong && res.length >= 12 && !civ.groups.some((g) => g.tribeId === t.id && g.kind === 'colonist')) {
        const site = civ.findSite(sim, t, s.x, s.y, 10, 36, true);
        if (site && launchColonists(sim, civ, t, s, site, s.lastCause, `escape from ${describeReason(s.econ.mainProblem || 'collapse')}`)) s.lastEmigration = tick;
      }
      continue;
    }
    const budget = crisisLong ? res.length : Math.floor(res.length * Math.min(0.3, push * 0.35));
    const keepMin = crisisLong ? 0 : MIN_VIABLE;
    if (budget <= 0) continue;
    const hh = households(res);
    // Deterministic shuffle so different households decide in different orders.
    for (let i = hh.length - 1; i > 0; i--) { const j = rng.int(0, i); const tmp = hh[i]; hh[i] = hh[j]; hh[j] = tmp; }
    let leaving = 0;
    const perDest = new Map<number, Creature[]>();
    for (const h of hh) {
      if (leaving + h.length > budget || res.length - leaving - h.length < keepMin) continue;
      if (h.some((c) => c.id === t.leaderId)) continue;
      if (!crisisLong && h.some((c) => tick - c.lastMigrated < CREATURE_COOLDOWN)) continue;
      // Only households fit for the road set out by choice: fed, watered, healthy and not near the end of life.
      if (!crisisLong && !h.every(fitToTravel)) continue;
      const curiosity = h.reduce((a, c) => a + c.curiosity, 0) / h.length;
      // Leaving one's own people is a bigger step than moving between their towns.
      const p = (crisisLong ? 1 : push * (0.55 + 0.45 * curiosity)) * (foreign ? 0.4 : 1);
      if (rng.next() > p) continue;
      // Softmax choice: the best destination is likely but not certain.
      const opts = scored.filter((o) => freeHousing(o.d) >= h.length);
      if (!opts.length) continue;
      const ws = opts.map((o) => Math.exp((o.score + familyBonus(sim, h, o.d)) / 0.08));
      const total = ws.reduce((a, b) => a + b, 0);
      let r = rng.next() * total, pick = opts[0];
      for (let k = 0; k < opts.length; k++) { r -= ws[k]; if (r <= 0) { pick = opts[k]; break; } }
      pick.d.reserved += h.length;
      const list = perDest.get(pick.d.id) ?? [];
      list.push(...h);
      perDest.set(pick.d.id, list);
      leaving += h.length;
    }
    if (!leaving) continue;
    const reason = crisisLong ? (s.econ.mainProblem || 'collapse') : s.econ.mainProblem || 'a search for a better life';
    for (const [did, members] of perDest) {
      const d = civ.settlementById.get(did)!;
      const supplies = Math.min(s.stock.food * 0.3, members.length * 5);
      s.stock.food -= supplies;
      const opt = scored.find((o) => o.d.id === did)!;
      const g = createGroup(sim, civ, { tribe: t, kind: 'economic', origin: s, dest: d, destX: d.x, destY: d.y, members, reason, causeId: s.lastCause, supplies, wood: 0, suitability: opt.score, reservedAt: did, hostTribeId: opt.host });
      if (!g) { d.reserved = Math.max(0, d.reserved - members.length); s.stock.food += supplies; continue; }
      const big = members.length >= 8 || crisisLong;
      const host = opt.host !== t.id ? civ.tribeById.get(opt.host) : undefined;
      const ev = settlementEvent(sim, s, {
        cat: 'migration', level: big || host ? 2 : 1, title: crisisLong ? `Exodus from ${s.name}` : host ? `Emigrants leave ${s.name}` : `Migrants leave ${s.name}`,
        text: `${members.length} ${members.length === 1 ? 'person' : 'people'} of ${t.name} left ${s.name} for ${d.name}${host ? `, a town of ${host.name}` : ''}, driven by ${describeReason(reason)}.`,
        tribeId: t.id, causeId: s.lastCause >= 0 ? s.lastCause : undefined,
      });
      g.causeId = ev.id;
    }
    s.lastEmigration = tick;
  }
}

function describeReason(r: string): string {
  switch (r) {
    case 'famine': return 'hunger';
    case 'drought': return 'failing water';
    case 'insecurity': return 'fear of raids';
    case 'overcrowding': return 'overcrowding';
    case 'unemployment': return 'a lack of work';
    case 'disease': return 'plague';
    case 'collapse': return 'the town’s collapse';
    default: return r;
  }
}

interface GroupSpec {
  tribe: Tribe;
  kind: MigrationKind;
  origin: Settlement | null;
  dest: Settlement | null;
  destX: number;
  destY: number;
  members: Creature[];
  reason: string;
  causeId: number;
  supplies: number;
  wood: number;
  suitability: number;
  hostTribeId?: number;
  reservedAt?: number;
}

/** Create a travelling group: plan its route, move its members out of their homes. */
export function createGroup(sim: Simulation, civ: CivManager, spec: GroupSpec): MigrationGroup | null {
  const members = spec.members.filter((c) => c.alive);
  if (!members.length) return null;
  const leader = members.reduce((a, b) => (scoreLeader(b) > scoreLeader(a) ? b : a));
  const swim = Math.min(...members.map((c) => c.swim));
  const path = routeFor(sim, civ, spec.tribe, leader.x, leader.y, spec.destX, spec.destY, swim);
  if (!path) return null;
  const tick = sim.tick;
  const d0 = dist2d(spec.destX - leader.x, spec.destY - leader.y);
  const g: MigrationGroup = {
    id: civ.nextGroupId++, tribeId: spec.tribe.id, hostTribeId: spec.hostTribeId ?? spec.tribe.id, kind: spec.kind,
    originId: spec.origin?.id ?? -1, originX: spec.origin?.x ?? leader.x, originY: spec.origin?.y ?? leader.y,
    destId: spec.dest?.id ?? -1, destX: spec.destX, destY: spec.destY, members: members.map((c) => c.id), leaderId: leader.id,
    reason: spec.reason, causeId: spec.causeId, started: tick, supplies: spec.supplies, wood: spec.wood, waypoints: path, wp: 0,
    startDist: Math.max(1, d0), bestDist: d0, lastProgressTick: tick, rerouted: false, suitability: spec.suitability, deaths: 0,
    size0: members.length, reservedAt: spec.reservedAt ?? -1,
  };
  civ.groups.push(g);
  civ.groupById.set(g.id, g);
  const destName = spec.dest ? spec.dest.name : 'new lands';
  for (const c of members) {
    if (c.homeId >= 0) { const h = civ.settlementById.get(c.homeId); if (h) h.population = Math.max(0, h.population - 1); }
    c.homeId = -1;
    c.migrationId = g.id;
    c.lastMigrated = tick;
    c.job = null;
    c.carry = 0;
    c.carryKind = null;
    c.decideIn = 0;
    c.remember(tick, 'migrate', spec.kind === 'refugee' ? `Fled ${spec.origin?.name ?? 'home'} as a refugee` : spec.kind === 'colonist' ? `Set out from ${spec.origin?.name ?? 'home'} to found a new settlement` : `Left ${spec.origin?.name ?? 'the wilds'} for ${destName}`);
  }
  if (spec.origin) {
    spec.origin.migOut += members.length;
    spec.tribe.migOut += members.length;
  }
  civ.counters.groups++;
  civ.counters.migrants += members.length;
  if (spec.kind === 'refugee') civ.counters.refugees += members.length;
  return g;
}

function scoreLeader(c: Creature): number {
  return (c.mature ? 2 : 0) + c.intelligence + c.age / c.lifespan * 0.5;
}

function routeFor(sim: Simulation, civ: CivManager, t: Tribe, x: number, y: number, tx: number, ty: number, swim: number): number[] | null {
  const sail = civ.hasTech(t.id, 'sailing');
  const enemies = civ.enemiesOf(t.id);
  const terr = sim.world.territory;
  const cost = enemies.length ? (i: number) => (enemies.includes(terr[i]) ? 3 : 1) : null;
  return findPath(sim.world, x, y, tx, ty, swim, sail, cost);
}

export function eatFromSupplies(c: Creature, g: MigrationGroup): void {
  if (g.supplies <= 0) return;
  const need = (c.maxEnergy * 0.9 - c.energy) / (PLANT_ENERGY * 0.9);
  const take = Math.max(0, Math.min(g.supplies, need));
  g.supplies -= take;
  c.energy += take * PLANT_ENERGY * 0.9;
}

/** Per-pass maintenance: prune the dead, track progress, arrive, re-route or strand. */
export function updateGroups(sim: Simulation, civ: CivManager): void {
  const tick = sim.tick;
  for (const g of civ.groups.slice()) {
    const alive: Creature[] = [];
    for (const id of g.members) {
      const c = sim.byId.get(id);
      if (c && c.alive && c.migrationId === g.id) alive.push(c);
    }
    g.members = alive.map((c) => c.id);
    if (!alive.length) {
      endGroup(sim, civ, g, 'perished', true);
      continue;
    }
    let leader = sim.byId.get(g.leaderId);
    if (!leader || !leader.alive || leader.migrationId !== g.id) {
      leader = alive.reduce((a, b) => (scoreLeader(b) > scoreLeader(a) ? b : a));
      g.leaderId = leader.id;
    }
    // A destination that was abandoned, sacked or changed hands is no longer a home: choose again now.
    if (g.destId >= 0) {
      const dest = civ.settlementById.get(g.destId);
      if (!dest || dest.destroyed || (dest.tribeId !== g.tribeId && dest.tribeId !== g.hostTribeId)) { retarget(sim, civ, g, alive); continue; }
    }
    const d = dist2d(g.destX - leader.x, g.destY - leader.y);
    if (d < g.bestDist - 1) { g.bestDist = d; g.lastProgressTick = tick; }
    if (d <= (g.destId >= 0 ? ARRIVE_TOWN : ARRIVE_SITE)) { arrive(sim, civ, g, alive); continue; }
    if (tick - g.lastProgressTick > STALL || tick - g.started > MAX_TRAVEL) {
      if (!g.rerouted) {
        g.rerouted = true;
        const swim = Math.min(...alive.map((c) => c.swim));
        const t = civ.tribeById.get(g.tribeId);
        const path = t ? routeFor(sim, civ, t, leader.x, leader.y, g.destX, g.destY, swim) : null;
        if (path) { g.waypoints = path; g.wp = 0; g.lastProgressTick = tick; continue; }
      }
      strand(sim, civ, g, alive);
    }
  }
}

function releaseReservation(civ: CivManager, g: MigrationGroup): void {
  if (g.reservedAt < 0) return;
  const d = civ.settlementById.get(g.reservedAt);
  if (d) d.reserved = Math.max(0, d.reserved - g.size0);
  g.reservedAt = -1;
}

function endGroup(sim: Simulation, civ: CivManager, g: MigrationGroup, how: 'arrived' | 'perished' | 'stranded', report: boolean): void {
  releaseReservation(civ, g);
  civ.groups = civ.groups.filter((x) => x !== g);
  civ.groupById.delete(g.id);
  for (const id of g.members) {
    const c = sim.byId.get(id);
    if (c && c.migrationId === g.id) c.migrationId = -1;
  }
  if (how === 'arrived') civ.counters.arrived++;
  else civ.counters.failed++;
  if (how === 'perished') civ.counters.lost++;
  if (how === 'perished' && report && g.size0 >= 4) {
    const t = civ.tribeById.get(g.tribeId);
    sim.events.push({
      tick: sim.tick, cat: 'migration', level: 2, title: g.kind === 'refugee' ? 'Refugees lost' : 'Migrants lost',
      text: `None of the ${g.size0} ${g.kind === 'refugee' ? 'refugees' : 'travellers'} of ${t?.name ?? 'a lost people'} reached ${g.destId >= 0 ? civ.settlementById.get(g.destId)?.name ?? 'their destination' : 'new lands'}.`,
      x: g.destX, y: g.destY, tribeId: g.tribeId, causeId: g.causeId >= 0 ? g.causeId : undefined,
    });
  }
}

function arrive(sim: Simulation, civ: CivManager, g: MigrationGroup, alive: Creature[]): void {
  const tick = sim.tick;
  if (g.destId < 0) { settleNew(sim, civ, g, alive); return; }
  const d = civ.settlementById.get(g.destId)!;
  const ok = !d.destroyed && (d.tribeId === g.tribeId || d.tribeId === g.hostTribeId);
  if (!ok) { retarget(sim, civ, g, alive); return; }
  const host = civ.tribeById.get(d.tribeId)!;
  for (const c of alive) {
    c.migrationId = -1;
    c.homeId = d.id;
    if (c.tribeId !== d.tribeId) {
      const from = civ.tribeById.get(c.tribeId);
      if (from) from.population = Math.max(0, from.population - 1);
      host.population++;
      c.tribeId = d.tribeId;
      c.remember(tick, 'joined', `Taken in by ${host.name} at ${d.name}`);
    } else c.remember(tick, 'arrive', `Settled in ${d.name}`);
  }
  d.migIn += alive.length;
  d.population += alive.length;
  host.migIn += alive.length;
  d.recentFrom[g.originId] = tick;
  releaseReservation(civ, g);
  const origin = g.originId >= 0 ? civ.settlementById.get(g.originId) : undefined;
  if (g.kind === 'refugee' || alive.length >= 8) {
    settlementEvent(sim, d, {
      cat: 'migration', level: g.kind === 'refugee' && alive.length >= 5 ? 2 : 1,
      title: g.kind === 'refugee' ? `Refugees reach ${d.name}` : `Migrants arrive in ${d.name}`,
      text: `${alive.length} ${g.kind === 'refugee' ? 'refugees' : 'migrants'}${origin ? ` from ${origin.name}` : ''} arrived in ${d.name}${g.deaths ? ` — ${g.deaths} died on the road` : ''}${host.id !== g.tribeId ? `; ${host.name} took them in` : ''}.`,
      tribeId: d.tribeId, causeId: g.causeId >= 0 ? g.causeId : undefined,
    });
  }
  endGroup(sim, civ, g, 'arrived', false);
}

/** Destination gone or unsuitable: head for the nearest settlement with room, or found one, or scatter. */
function retarget(sim: Simulation, civ: CivManager, g: MigrationGroup, alive: Creature[]): void {
  releaseReservation(civ, g);
  const t = civ.tribeById.get(g.tribeId);
  const leader = sim.byId.get(g.leaderId)!;
  if (t && !t.collapsed) {
    let best: Settlement | null = null, bd = Infinity;
    for (const sid of t.settlementIds) {
      const s = civ.settlement(sid);
      if (!s || freeHousing(s, 1.4) < alive.length) continue;
      const dd = dist2d(s.x - leader.x, s.y - leader.y);
      if (dd < bd) { bd = dd; best = s; }
    }
    const swim = Math.min(...alive.map((c) => c.swim));
    if (best) {
      const path = routeFor(sim, civ, t, leader.x, leader.y, best.x, best.y, swim);
      if (path) {
        Object.assign(g, { destId: best.id, destX: best.x, destY: best.y, waypoints: path, wp: 0, lastProgressTick: sim.tick, bestDist: bd, startDist: Math.max(1, bd), reservedAt: best.id });
        best.reserved += g.size0;
        return;
      }
    }
    if (alive.length >= 5) {
      const site = civ.findSite(sim, t, leader.x, leader.y, 0, 14, true);
      if (site) {
        const path = routeFor(sim, civ, t, leader.x, leader.y, site.x, site.y, swim);
        if (path) {
          Object.assign(g, { destId: -1, destX: site.x, destY: site.y, waypoints: path, wp: 0, lastProgressTick: sim.tick, bestDist: dist2d(site.x - leader.x, site.y - leader.y) });
          return;
        }
      }
    }
  }
  strand(sim, civ, g, alive);
}

/** Found (or resettle) a settlement where colonists or homeless refugees arrive. */
function settleNew(sim: Simulation, civ: CivManager, g: MigrationGroup, alive: Creature[]): void {
  const t = civ.tribeById.get(g.tribeId);
  if (!t || t.collapsed) { strand(sim, civ, g, alive); return; }
  const leader = sim.byId.get(g.leaderId)!;
  let site: { x: number; y: number; ruinId: number } | null = civ.siteValid(sim, t, g.destX, g.destY) ? { x: g.destX, y: g.destY, ruinId: civ.ruinNear(g.destX, g.destY, 4, sim, t)?.id ?? -1 } : null;
  if (!site) site = civ.findSite(sim, t, leader.x, leader.y, 0, 8, true);
  if (!site || alive.length < 3) { retargetOrStrand(); return; }
  const origin = g.originId >= 0 ? civ.settlementById.get(g.originId) : undefined;
  const s = civ.establish(sim, t, site.x, site.y, alive, origin ?? null, g.kind === 'refugee' ? 'refuge' : 'colonized', g.causeId, site.ruinId);
  s.stock.food += g.supplies;
  s.wood += g.wood;
  g.supplies = 0;
  endGroup(sim, civ, g, 'arrived', false);

  function retargetOrStrand() {
    if (g.rerouted) strand(sim, civ, g, alive);
    else { g.rerouted = true; retarget(sim, civ, g, alive); }
  }
}

/** The journey failed: members become homeless members of their people (they may regroup later). */
function strand(sim: Simulation, civ: CivManager, g: MigrationGroup, alive: Creature[]): void {
  for (const c of alive) {
    c.migrationId = -1;
    c.remember(sim.tick, 'stranded', 'The journey failed; stranded far from home');
  }
  civ.counters.stranded += alive.length;
  if (g.size0 >= 5) {
    const t = civ.tribeById.get(g.tribeId);
    sim.events.push({
      tick: sim.tick, cat: 'migration', level: 1, title: 'A journey fails',
      text: `${alive.length} ${g.kind === 'refugee' ? 'refugees' : 'travellers'} of ${t?.name ?? 'a scattered people'} could not reach ${g.destId >= 0 ? civ.settlementById.get(g.destId)?.name ?? 'their goal' : 'new lands'} and scattered.`,
      x: sim.byId.get(g.leaderId)?.x ?? g.destX, y: sim.byId.get(g.leaderId)?.y ?? g.destY, tribeId: g.tribeId,
      causeId: g.causeId >= 0 ? g.causeId : undefined,
    });
  }
  endGroup(sim, civ, g, 'stranded', false);
}

/** Residents of a destroyed or collapsing settlement flee to friends, allies or the wilderness. */
export function makeRefugees(sim: Simulation, civ: CivManager, s: Settlement, residents: Creature[], causeId: number, why: string): void {
  const t = civ.tribeById.get(s.tribeId);
  if (!t || !residents.length) return;
  const hh = households(residents);
  // Children whose parents died still need to go somewhere: attach to the first household.
  const inHh = new Set(hh.flat().map((c) => c.id));
  const orphans = residents.filter((c) => !inHh.has(c.id));
  if (orphans.length) { if (hh.length) hh[0].push(...orphans); else hh.push(orphans); }
  const dests: { s: Settlement; host: number }[] = [];
  for (const sid of t.settlementIds) { const d = civ.settlement(sid); if (d && d.id !== s.id) dests.push({ s: d, host: t.id }); }
  for (const aid of civ.alliesOf(t.id)) {
    const at = civ.tribeById.get(aid);
    if (!at) continue;
    for (const sid of at.settlementIds) { const d = civ.settlement(sid); if (d) dests.push({ s: d, host: aid }); }
  }
  dests.sort((a, b) => dist2d(a.s.x - s.x, a.s.y - s.y) - dist2d(b.s.x - s.x, b.s.y - s.y) + (a.host === t.id ? -20 : 0) - (b.host === t.id ? -20 : 0));
  const perDest = new Map<number, { d: Settlement; host: number; members: Creature[] }>();
  const unplaced: Creature[] = [];
  for (const h of hh) {
    const opt = dests.find((o) => dist2d(o.s.x - s.x, o.s.y - s.y) < 110 && freeHousing(o.s, 1.5) >= h.length && reachable(sim, civ, t, s, o.s));
    if (!opt) { unplaced.push(...h); continue; }
    opt.s.reserved += h.length;
    const e = perDest.get(opt.s.id) ?? { d: opt.s, host: opt.host, members: [] };
    e.members.push(...h);
    perDest.set(opt.s.id, e);
  }
  let total = 0;
  const supplies = s.stock.food * 0.5;
  s.stock.food -= supplies;
  for (const { d, host, members } of perDest.values()) {
    const g = createGroup(sim, civ, { tribe: t, kind: 'refugee', origin: s, dest: d, destX: d.x, destY: d.y, members, reason: why, causeId, supplies: supplies * members.length / residents.length, wood: 0, suitability: 0, hostTribeId: host, reservedAt: d.id });
    if (g) total += members.length;
    else { d.reserved = Math.max(0, d.reserved - members.length); unplaced.push(...members); }
  }
  if (unplaced.length >= 5) {
    const site = civ.findSite(sim, t, s.x, s.y, 8, 26, true);
    if (site) {
      const g = createGroup(sim, civ, { tribe: t, kind: 'refugee', origin: s, dest: null, destX: site.x, destY: site.y, members: unplaced, reason: why, causeId, supplies: 0, wood: 0, suitability: 0 });
      if (g) { total += unplaced.length; unplaced.length = 0; }
    }
  }
  if (total > 0) {
    settlementEvent(sim, s, {
      cat: 'migration', level: total >= 15 ? 3 : 2, title: `Refugees flee ${s.name}`,
      text: `${total} people fled ${s.name} after ${why}${unplaced.length ? `; ${unplaced.length} scattered into the wilds` : ''}.`,
      tribeId: t.id, causeId: causeId >= 0 ? causeId : undefined,
    });
    civ.counters.refugeeGroups++;
  }
  for (const c of unplaced) c.homeId = -1;
}

/** Send colonists from a settlement to found a new one at a chosen site. */
export function launchColonists(sim: Simulation, civ: CivManager, t: Tribe, source: Settlement, site: { x: number; y: number; ruinId: number }, causeId: number, why: string): MigrationGroup | null {
  const res = civ.residents.get(source.id) ?? [];
  const crisis = source.state === 'crisis';
  const hh = households(res).filter((h) => !h.some((c) => c.id === t.leaderId) && (crisis || h.every(fitToTravel)));
  const rng = sim.rng;
  for (let i = hh.length - 1; i > 0; i--) { const j = rng.int(0, i); const tmp = hh[i]; hh[i] = hh[j]; hh[j] = tmp; }
  const members: Creature[] = [];
  const cap = Math.floor(res.length * 0.3);
  for (const h of hh) {
    if (members.length >= 6 && members.length + h.length > cap) break;
    if (members.length + h.length > cap && members.length >= 6) continue;
    members.push(...h);
  }
  if (members.length < 6 || res.length - members.length < MIN_VIABLE) return null;
  const supplies = Math.min(source.stock.food * 0.35, members.length * 6);
  const wood = Math.min(source.stock.wood, 6);
  const g = createGroup(sim, civ, { tribe: t, kind: 'colonist', origin: source, dest: null, destX: site.x, destY: site.y, members, reason: why, causeId, supplies, wood, suitability: 0 });
  if (!g) return null;
  source.stock.food -= supplies;
  source.stock.wood -= wood;
  const ev = settlementEvent(sim, source, {
    cat: 'migration', level: 2, title: `Colonists leave ${source.name}`,
    text: `${members.length} colonists of ${t.name} set out from ${source.name} to ${site.ruinId >= 0 ? `resettle the ruins of ${civ.settlementById.get(site.ruinId)?.name}` : 'found a new settlement'}, seeking ${why}.`,
    tribeId: t.id, causeId: causeId >= 0 ? causeId : undefined,
  });
  g.causeId = ev.id;
  civ.counters.colonistGroups++;
  return g;
}

export function groupView(sim: Simulation, civ: CivManager, g: MigrationGroup): MigrationGroupView {
  const leader = sim.byId.get(g.leaderId);
  const t = civ.tribeById.get(g.tribeId);
  const origin = g.originId >= 0 ? civ.settlementById.get(g.originId) : undefined;
  const dest = g.destId >= 0 ? civ.settlementById.get(g.destId) : undefined;
  const x = leader?.x ?? g.originX, y = leader?.y ?? g.originY;
  return {
    id: g.id, kind: g.kind, tribeId: g.tribeId, hue: t?.hue ?? 0, x, y, ox: g.originX, oy: g.originY, dx: g.destX, dy: g.destY,
    size: g.members.length, progress: clamp(1 - dist2d(g.destX - x, g.destY - y) / g.startDist, 0, 1), reason: g.reason,
    originId: g.originId, destId: g.destId,
    originName: origin?.name ?? 'the wilds', destName: dest?.name ?? (g.kind === 'colonist' ? 'a new settlement' : 'new lands'),
    suitability: g.suitability, started: g.started, deaths: g.deaths,
  };
}

/** Next point a migrant should walk to. */
export function migrantTarget(sim: Simulation, g: MigrationGroup, c: Creature): { x: number; y: number } {
  const leader = sim.byId.get(g.leaderId);
  if (leader && leader !== c && leader.alive) {
    const dl = dist2d(leader.x - c.x, leader.y - c.y);
    if (dl > 3.5) {
      const a = (c.id * 2.399) % (Math.PI * 2);
      return { x: leader.x + Math.cos(a) * 1.2, y: leader.y + Math.sin(a) * 1.2 };
    }
  }
  while (g.wp < g.waypoints.length - 2) {
    const wx = g.waypoints[g.wp], wy = g.waypoints[g.wp + 1];
    if (leader === c && dist2d(wx - c.x, wy - c.y) < 1.6) g.wp += 2;
    else break;
  }
  const k = Math.min(g.wp, g.waypoints.length - 2);
  return { x: g.waypoints[k], y: g.waypoints[k + 1] };
}

export { PASSES_PER_DAY };
