/**
 * Settlement economy, lifecycle, decay and history.
 *
 * A settlement's condition is derived every civ pass from its residents (creature.homeId), its local
 * stores and its surroundings. The lifecycle state machine uses state-dependent thresholds (hysteresis)
 * and minimum durations, so settlements don't flicker between states.
 */
import type { Simulation } from '../simulation';
import type { Creature } from '../creatures/creature';
import type { CivManager, Tribe } from './civilization';
import { CIV_INTERVAL, TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR } from '../constants';
import type { SettlementState, SettlementView, SimEvent } from '../types';

export interface Stock { food: number; wood: number; stone: number; ore: number }

export interface SettlementEra {
  tribeId: number;
  tribeName: string;
  start: number;
  end: number | null;
  peak: number;
  how: 'founded' | 'colonized' | 'resettled' | 'seceded' | 'refuge';
  endReason: string | null;
}

export interface SettlementEcon {
  /** Food units per day entering the stores (gathered + traded). */
  foodProd: number;
  /** Food units per day taken from the stores. */
  foodCons: number;
  imports: number;
  reserveDays: number;
  housing: number;
  jobs: number;
  employment: number;
  water: number;
  security: number;
  disease: number;
  crowding: number;
  /** Smoothed overall condition in [-1, 1]. */
  prosperity: number;
  /** Smoothed push-to-leave in [0, 1]. */
  pressure: number;
  mainProblem: string;
  balance: number;
  /** How well fed the residents are, in [0, 1] (smoothed mean energy fraction). */
  nourishment: number;
}

export interface Settlement {
  id: number;
  tribeId: number;
  name: string;
  x: number;
  y: number;
  tier: number;
  founded: number;
  health: number;
  /** Current residents (creatures whose homeId is this settlement). */
  population: number;
  /** Wooden structure points (huts, houses): rot within years once abandoned. */
  wood: number;
  /** Stone structure points: survive for decades. */
  stone: number;
  walls: boolean;
  wallCondition: number;
  farms: number[];
  /** True when not an active population centre (abandoned or ruins). */
  destroyed: boolean;
  /** Tick of abandonment. */
  destroyedTick: number;
  state: SettlementState;
  stateSince: number;
  pending: SettlementState | null;
  pendingSince: number;
  lastStateEvent: number;
  stock: Stock;
  econ: SettlementEcon;
  prodAcc: number;
  consAcc: number;
  importAcc: number;
  threat: number;
  peak: number;
  popHistory: number[];
  eras: SettlementEra[];
  parentId: number;
  events: number[];
  migIn: number;
  migOut: number;
  reserved: number;
  lastEmigration: number;
  /** Settlement id -> tick of the last migration that arrived from it (anti-oscillation). */
  recentFrom: Record<number, number>;
  lastCause: number;
  crisisSince: number;
  woodAtAbandon: number;
  oldFarms: number[];
  farmCondition: number;
  reclaimed: boolean;
  thrivedThisEra: boolean;
}

export const PASSES_PER_DAY = TICKS_PER_DAY / CIV_INTERVAL;
const MIN_DAYS: Partial<Record<SettlementState, number>> = { crisis: 1, abandoned: 2, declining: 2, thriving: 2, growing: 1.5, stable: 1.5 };
export const TIER_NAMES = ['Camp', 'Village', 'Town', 'City'];
export const STATE_LABEL: Record<SettlementState, string> = {
  founded: 'Newly founded', growing: 'Growing', thriving: 'Thriving', stable: 'Stable', declining: 'Declining',
  crisis: 'In crisis', abandoned: 'Abandoned', ruins: 'Ruins',
};

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const ema = (prev: number, v: number, k: number) => prev + (v - prev) * k;

export function emptyEcon(): SettlementEcon {
  return {
    foodProd: 0, foodCons: 0, imports: 0, reserveDays: 6, housing: 8, jobs: 6, employment: 1, water: 1, security: 1,
    disease: 0, crowding: 0.5, prosperity: 0.2, pressure: 0, mainProblem: '', balance: 0, nourishment: 0.7,
  };
}

export function newSettlement(id: number, t: Tribe, name: string, x: number, y: number, tick: number, how: SettlementEra['how'], parentId: number): Settlement {
  return {
    id, tribeId: t.id, name, x, y, tier: 0, founded: tick, health: 100, population: 0,
    wood: 2, stone: 0, walls: false, wallCondition: 0, farms: [], destroyed: false, destroyedTick: 0,
    state: 'founded', stateSince: tick, pending: null, pendingSince: tick, lastStateEvent: tick,
    stock: { food: 0, wood: 0, stone: 0, ore: 0 }, econ: emptyEcon(), prodAcc: 0, consAcc: 0, importAcc: 0, threat: 0,
    peak: 0, popHistory: [], eras: [{ tribeId: t.id, tribeName: t.name, start: tick, end: null, peak: 0, how, endReason: null }],
    parentId, events: [], migIn: 0, migOut: 0, reserved: 0, lastEmigration: -1e9, recentFrom: {}, lastCause: -1,
    crisisSince: -1, woodAtAbandon: 0, oldFarms: [], farmCondition: 0, reclaimed: false, thrivedThisEra: false,
  };
}

export function housingOf(s: Settlement): number {
  return 6 + s.wood + s.stone * 1.5;
}

export function structurePoints(s: Settlement): number {
  return s.wood + s.stone;
}

export function currentEra(s: Settlement): SettlementEra {
  return s.eras[s.eras.length - 1];
}

/** Record an event against a settlement's local history. */
export function noteEvent(s: Settlement, e: SimEvent): void {
  s.events.push(e.id);
  if (s.events.length > 24) s.events.shift();
}

export function settlementEvent(sim: Simulation, s: Settlement, e: Omit<SimEvent, 'id' | 'tick' | 'x' | 'y' | 'settlementId'>): SimEvent {
  const ev = sim.events.push({ ...e, tick: sim.tick, x: s.x, y: s.y, settlementId: s.id });
  noteEvent(s, ev);
  return ev;
}

/** Economy pass: derive this settlement's condition from its residents, stores and surroundings. */
export function updateEconomy(sim: Simulation, civ: CivManager, s: Settlement, residents: Creature[]): void {
  const e = s.econ;
  const w = sim.world;
  const n = residents.length;
  e.foodProd = ema(e.foodProd, s.prodAcc * PASSES_PER_DAY, 0.12);
  e.foodCons = ema(e.foodCons, s.consAcc * PASSES_PER_DAY, 0.12);
  e.imports = ema(e.imports, s.importAcc * PASSES_PER_DAY, 0.1);
  s.prodAcc = 0; s.consAcc = 0; s.importAcc = 0;
  const need = Math.max(e.foodCons, n * 2.5);
  e.reserveDays = n > 0 ? s.stock.food / Math.max(1, need) : 0;
  e.housing = housingOf(s);
  e.jobs = 6 + s.farms.length * 2 + s.tier * 5;
  e.employment = n > 0 ? Math.min(1, e.jobs / n) : 1;
  e.crowding = n / e.housing;
  const i = w.tileAt(s.x, s.y);
  const wd = w.waterDist[i];
  let water = wd <= 2 ? 1 : wd <= 5 ? 0.75 : wd <= 9 ? 0.45 : 0.2;
  if (sim.climate.droughtTicks > 0 && wd > 1) water *= 1 - sim.climate.droughtSeverity * 0.5;
  e.water = water;
  // Insecurity: raids and killings feed a decaying threat level; nearby enemies add to it.
  s.threat *= 0.9;
  const t = civ.tribe(s.tribeId);
  if (t) {
    for (const eid of civ.enemiesOf(t.id)) {
      const et = civ.tribe(eid);
      if (!et) continue;
      for (const sid of et.settlementIds) {
        const es = civ.settlement(sid);
        if (es && Math.abs(es.x - s.x) + Math.abs(es.y - s.y) < 45) { s.threat += 0.03; break; }
      }
    }
  }
  s.threat = Math.min(1.5, s.threat);
  e.security = clamp(1 - s.threat, 0, 1);
  let infected = 0, fed = 0;
  for (const c of residents) { if (c.infection > 0) infected++; fed += Math.min(c.energy / c.maxEnergy, c.hydration); }
  e.disease = n > 0 ? infected / n : 0;
  if (n > 0) e.nourishment = ema(e.nourishment ?? 0.7, fed / n, 0.2);

  // Condition scores in [-1, 1].
  // Most food is still foraged and eaten directly; stores are a buffer. Food security therefore weighs
  // how well fed people actually are, with reserves and the store balance as secondary signals.
  const reserveScore = clamp(e.reserveDays / 4, 0, 1) * 1.3 - 0.3;
  e.balance = clamp((e.foodProd + e.imports - e.foodCons) / Math.max(4, e.foodCons), -1, 1);
  const nourishScore = clamp((e.nourishment - 0.55) / 0.25, -1, 1);
  const food = 0.6 * nourishScore + 0.25 * reserveScore + 0.15 * e.balance;
  const housing = e.crowding <= 0.85 ? 1 : clamp(1 - (e.crowding - 0.85) * 4, -1, 1);
  const waterS = water * 2 - 1, sec = e.security * 2 - 1, jobs = e.employment * 2 - 1;
  const disease = 1 - 2 * Math.min(1, e.disease * 3);
  const raw = 0.36 * food + 0.14 * waterS + 0.16 * sec + 0.14 * housing + 0.1 * jobs + 0.1 * disease;
  e.prosperity = ema(e.prosperity, raw, 0.2);
  const factors: [string, number][] = [['famine', food], ['drought', waterS], ['insecurity', sec], ['overcrowding', housing], ['unemployment', jobs], ['disease', disease]];
  factors.sort((a, b) => a[1] - b[1]);
  e.mainProblem = factors[0][1] < -0.2 ? factors[0][0] : '';
  const push = clamp(-e.prosperity * 1.3, 0, 1) + clamp((e.crowding - 1.05) * 1.5, 0, 0.5) + (s.state === 'crisis' ? 0.15 : 0);
  e.pressure = ema(e.pressure, clamp(push, 0, 1), 0.25);
}

/** Lifecycle pass for active settlements: choose a target state and transition after its minimum duration. */
export function evaluateLifecycle(sim: Simulation, civ: CivManager, s: Settlement): void {
  if (s.destroyed) return;
  const tick = sim.tick;
  const n = s.population;
  if (n > s.peak) s.peak = n;
  const era = currentEra(s);
  if (n > era.peak) era.peak = n;
  if (civ.pass % PASSES_PER_DAY === 0) {
    s.popHistory.push(n);
    if (s.popHistory.length > 400) s.popHistory.shift();
  }
  const hist = s.popHistory;
  const old = hist.length > 2 ? hist[hist.length - 3] : n;
  const trend = (n - old) / Math.max(6, old);
  const e = s.econ;
  const cur = s.state;
  let target: SettlementState;
  if (n === 0) target = s.reserved > 0 ? cur : 'abandoned';
  else if (tick - era.start < TICKS_PER_DAY * 3) target = 'founded';
  else {
    const crisisTh = cur === 'crisis' ? -0.3 : -0.45;
    const declTh = cur === 'declining' || cur === 'crisis' ? -0.05 : -0.15;
    const thriveTh = cur === 'thriving' ? 0.35 : 0.45;
    if (e.prosperity < crisisTh || (e.reserveDays < 0.4 && e.balance < -0.3)) target = 'crisis';
    else if (e.prosperity < declTh || trend < -0.2) target = 'declining';
    else if (e.prosperity > thriveTh && n >= 12) target = 'thriving';
    else if (trend > 0.1) target = 'growing';
    else target = 'stable';
  }
  if (target === cur) { s.pending = null; return; }
  if (s.pending !== target) { s.pending = target; s.pendingSince = tick; return; }
  const minDays = MIN_DAYS[target] ?? 0;
  if (tick - s.pendingSince < minDays * TICKS_PER_DAY) return;
  transition(sim, civ, s, target);
}

function transition(sim: Simulation, civ: CivManager, s: Settlement, to: SettlementState): void {
  const from = s.state;
  if (to === 'abandoned') {
    abandon(sim, civ, s, 'its last inhabitants left or died', s.lastCause);
    return;
  }
  s.state = to;
  s.stateSince = sim.tick;
  s.pending = null;
  const t = civ.tribe(s.tribeId);
  const tn = t ? t.name : 'its people';
  const throttled = sim.tick - s.lastStateEvent < TICKS_PER_DAY * 4;
  if (to === 'crisis') {
    s.crisisSince = sim.tick;
    const problem = s.econ.mainProblem || 'hardship';
    const what = problem === 'famine' ? 'Famine' : problem === 'drought' ? 'Drought' : problem === 'insecurity' ? 'Siege and fear'
      : problem === 'overcrowding' ? 'Overcrowding' : problem === 'disease' ? 'Plague' : problem === 'unemployment' ? 'Idleness and want' : 'Hardship';
    const cause = causeFor(sim, s, problem);
    const ev = settlementEvent(sim, s, {
      cat: 'settlement', level: s.population >= 8 ? 2 : 1, title: `Crisis in ${s.name}`,
      text: `${what} grips ${s.name} of ${tn}: ${Math.round(s.econ.reserveDays * 10) / 10} days of food left for ${s.population} people.`,
      tribeId: s.tribeId, causeId: cause >= 0 ? cause : undefined,
    });
    s.lastCause = ev.id;
    s.lastStateEvent = sim.tick;
  } else {
    if (from === 'crisis') s.crisisSince = -1;
    if (to === 'declining' && !throttled && s.population >= 6) {
      const ev = settlementEvent(sim, s, {
        cat: 'settlement', level: 1, title: `${s.name} declines`,
        text: `${s.name} of ${tn} is in decline${s.econ.mainProblem ? `, troubled by ${s.econ.mainProblem}` : ''}.`,
        tribeId: s.tribeId, causeId: s.lastCause >= 0 ? s.lastCause : undefined,
      });
      if (s.lastCause < 0) s.lastCause = ev.id;
      s.lastStateEvent = sim.tick;
    } else if (to === 'thriving' && !s.thrivedThisEra) {
      s.thrivedThisEra = true;
      settlementEvent(sim, s, {
        cat: 'settlement', level: 1, title: `${s.name} thrives`,
        text: `${s.name} of ${tn} is thriving: full stores, room to grow and ${s.population} inhabitants.`, tribeId: s.tribeId,
      });
      s.lastStateEvent = sim.tick;
    } else if ((to === 'growing' || to === 'stable') && (from === 'crisis' || from === 'declining')) {
      if (!throttled) {
        settlementEvent(sim, s, {
          cat: 'settlement', level: 1, title: `${s.name} recovers`, text: `${s.name} of ${tn} has recovered from its troubles.`,
          tribeId: s.tribeId, causeId: s.lastCause >= 0 ? s.lastCause : undefined,
        });
        s.lastStateEvent = sim.tick;
      }
      s.lastCause = -1;
    }
  }
}

/** Find the simulation event that best explains a settlement's current problem. */
function causeFor(sim: Simulation, s: Settlement, problem: string): number {
  const cl = sim.climate;
  if ((problem === 'famine' || problem === 'drought') && sim.droughtEventId >= 0 && (cl.droughtTicks > 0 || sim.tick - sim.droughtEndTick < TICKS_PER_DAY * 12)) return sim.droughtEventId;
  if (problem === 'disease' && sim.plagueEventId >= 0) return sim.plagueEventId;
  return s.lastCause;
}

/** Abandon a settlement: it stops being a population centre but keeps its identity and starts to decay. */
export function abandon(sim: Simulation, civ: CivManager, s: Settlement, reason: string, causeId: number, cat: SimEvent['cat'] = 'settlement', announce = true): SimEvent | null {
  const tick = sim.tick;
  const t = civ.tribe(s.tribeId);
  s.state = 'abandoned';
  s.stateSince = tick;
  s.pending = null;
  s.destroyed = true;
  s.destroyedTick = tick;
  s.reserved = 0;
  s.population = 0;
  // Nobody keeps living in, working for or eating from an abandoned place.
  for (const c of sim.creatures) if (c.homeId === s.id) { c.homeId = -1; c.job = null; }
  s.woodAtAbandon = s.wood;
  const era = currentEra(s);
  era.end = tick;
  era.endReason = reason;
  s.oldFarms = s.farms.slice();
  s.farmCondition = s.farms.length ? 1 : 0;
  for (const f of s.farms) sim.world.farm[f] = 0;
  s.farms = [];
  if (t) {
    t.settlementIds = t.settlementIds.filter((id) => id !== s.id);
    if (t.settlementIds.length === 0) t.nomadicSince = tick;
  }
  civ.territoryDirty = true;
  civ.counters.abandoned++;
  if (t) t.recentLossTick = tick;
  if (!announce) {
    if (causeId >= 0) s.lastCause = causeId;
    return null;
  }
  const years = (tick - era.start) / TICKS_PER_YEAR;
  const ev = settlementEvent(sim, s, {
    cat, level: s.peak >= 25 ? 3 : 2, title: `${s.name} abandoned`,
    text: `${s.name}${t ? ` of ${t.name}` : ''} has been abandoned — ${reason}. It stood for ${years < 1 ? `${Math.max(1, Math.round(years * 20))} days` : `${years.toFixed(1)} years`} and once held ${s.peak} people.`,
    tribeId: s.tribeId, causeId: causeId >= 0 ? causeId : undefined,
  });
  s.lastCause = ev.id;
  civ.lastLossEvent.set(s.tribeId, ev.id);
  return ev;
}

/** Decay of abandoned settlements: wood rots in years, stone lasts decades, farms go wild in months. */
export function deteriorate(sim: Simulation, civ: CivManager, s: Settlement): void {
  if (!s.destroyed) return;
  const w = sim.world;
  const i = w.tileAt(s.x, s.y);
  const dtY = CIV_INTERVAL / TICKS_PER_YEAR;
  const temp = w.baseTemp[i] + sim.climate.globalOffset();
  // Warm, wet climates rot wood faster; cold, dry ones preserve it.
  const climate = clamp(0.6 + w.moisture[i] * 0.6 + Math.max(0, temp) * 0.015, 0.4, 1.6);
  s.wood *= Math.exp(-dtY * climate / 0.6);
  s.stone *= Math.exp(-dtY * Math.LN2 / 40);
  s.wallCondition *= Math.exp(-dtY * Math.LN2 / 25);
  s.farmCondition *= Math.exp(-dtY / 0.25);
  s.health = Math.max(0, s.health - dtY * 40);
  s.stock.food *= 0.9;
  s.stock.wood *= 0.995;
  if (s.state === 'abandoned' && (s.wood < s.woodAtAbandon * 0.3 + 0.2 || sim.tick - s.destroyedTick > TICKS_PER_YEAR)) {
    s.state = 'ruins';
    s.stateSince = sim.tick;
    if (s.peak >= 12) {
      settlementEvent(sim, s, {
        cat: 'settlement', level: 1, title: `${s.name} falls to ruin`,
        text: `The wooden halls of ${s.name} have rotted away; ${s.stone > 1 ? 'only stone remains standing' : 'little now marks the place'}.`,
        tribeId: s.tribeId, causeId: s.lastCause >= 0 ? s.lastCause : undefined,
      });
    }
  }
  if (s.state === 'ruins' && !s.reclaimed && s.wood < 0.2 && s.stone < 0.3 && s.wallCondition < 0.1) s.reclaimed = true;
}

/** Territory weight of an abandoned settlement: claims fade over one season. */
export function residualClaim(sim: Simulation, s: Settlement): number {
  if (!s.destroyed) return 1;
  return Math.max(0, 1 - (sim.tick - s.destroyedTick) / TICKS_PER_SEASON);
}

/** Bring an abandoned settlement back to life under a new (or the same) people. */
export function resettle(sim: Simulation, civ: CivManager, s: Settlement, t: Tribe, how: SettlementEra['how'], causeId: number): SimEvent {
  const tick = sim.tick;
  const prev = currentEra(s);
  const prevOwner = prev.tribeName;
  const yearsAgo = (tick - s.destroyedTick) / TICKS_PER_YEAR;
  s.tribeId = t.id;
  s.destroyed = false;
  s.state = 'founded';
  s.stateSince = tick;
  s.pending = null;
  s.reclaimed = false;
  s.crisisSince = -1;
  s.thrivedThisEra = false;
  s.eras.push({ tribeId: t.id, tribeName: t.name, start: tick, end: null, peak: 0, how, endReason: null });
  // Salvage: some timber can be reused, stone stands as it is, walls if they still stand.
  s.wood = s.wood * 0.8 + 2;
  s.walls = s.walls && s.wallCondition > 0.35;
  s.health = Math.min(100, 50 + structurePoints(s) * 2);
  s.stock.food = 0;
  s.threat = 0;
  s.econ = emptyEcon();
  s.recentFrom = {};
  const maxTier = s.stone >= 60 ? 3 : s.stone >= 25 ? 2 : structurePoints(s) >= 10 ? 1 : 0;
  s.tier = Math.min(s.tier, maxTier);
  if (t.techs.includes('agriculture')) {
    for (const f of s.oldFarms) if (s.farmCondition > 0.25 && sim.world.isLand(f)) { sim.world.farm[f] = 1; s.farms.push(f); }
  }
  s.oldFarms = [];
  s.farmCondition = 0;
  t.settlementIds.push(s.id);
  civ.territoryDirty = true;
  civ.counters.resettled++;
  const ago = yearsAgo < 1 ? `${Math.max(1, Math.round(yearsAgo * 20))} days` : `${yearsAgo.toFixed(1)} years`;
  const ev = settlementEvent(sim, s, {
    cat: 'settlement', level: 2, title: `${s.name} resettled`,
    text: `${t.name} resettled ${s.name}, abandoned ${ago} ago${prevOwner !== t.name ? ` by ${prevOwner}` : ''}. ${s.stone > 1 || s.walls ? 'The old stonework was put to use again.' : 'Little of the old town remained.'}`,
    tribeId: t.id, causeId: causeId >= 0 ? causeId : undefined,
  });
  return ev;
}

export function settlementView(civ: CivManager, s: Settlement): SettlementView {
  const t = civ.tribe(s.tribeId) ?? civ.tribeById.get(s.tribeId);
  return {
    id: s.id, tribeId: s.tribeId, name: s.name, x: s.x, y: s.y, tier: s.tier, health: s.health, population: s.population,
    hue: t?.hue ?? 0, founded: s.founded, destroyed: s.destroyed, walls: s.walls && s.wallCondition > 0.1, farms: s.farms.length,
    state: s.state, prosperity: s.econ.prosperity, reserveDays: s.econ.reserveDays, crowding: s.econ.crowding, nourishment: s.econ.nourishment ?? 0.7,
    wood: s.destroyed ? Math.min(1, s.wood / Math.max(1, s.woodAtAbandon)) : 1,
    stone: s.destroyed ? Math.min(1, s.stone / 20) : 1,
    wallCondition: s.wallCondition, oldFarms: s.destroyed && s.farmCondition > 0.05 ? s.oldFarms : [], farmCondition: s.farmCondition,
    reclaimed: s.reclaimed, eras: s.eras.length,
  };
}

/** Upgrade a version-3 settlement record (single building counter, tribe-level stores). */
export function upgradeV3Settlement(d: Record<string, unknown>, tick: number, tribeName: string): Settlement {
  const s = d as unknown as Settlement & { buildings?: number };
  const destroyed = !!d.destroyed;
  // Version 3 did not model housing: whoever lived in a town was housed, so its timber must cover them.
  const buildings = Math.max((d.buildings as number) ?? 2, destroyed ? 0 : ((d.population as number) ?? 0) * 0.85 - 6);
  const upgraded: Settlement = {
    ...newSettlement(s.id, { id: s.tribeId, name: tribeName } as Tribe, s.name, s.x, s.y, s.founded, 'founded', -1),
    tier: s.tier, health: s.health, population: s.population, wood: buildings, stone: 0, walls: !!s.walls, wallCondition: s.walls ? 1 : 0,
    farms: (s.farms ?? []).slice(), destroyed, destroyedTick: (d.destroyedTick as number) ?? 0,
    state: destroyed ? 'abandoned' : 'stable', stateSince: tick, peak: s.population, woodAtAbandon: buildings,
  };
  if (destroyed) { upgraded.eras[0].end = (d.destroyedTick as number) ?? tick; upgraded.eras[0].endReason = 'destroyed'; }
  return upgraded;
}
