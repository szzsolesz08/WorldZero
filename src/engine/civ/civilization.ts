import type { Simulation } from '../simulation';
import type { Creature } from '../creatures/creature';
import { moveToward, planExplore, attack } from '../creatures/behavior';
import { BIOMES } from '../world/biomes';
import { TECH_BY_ID, availableTechs } from './tech';
import { settlementName, tribeName } from '../creatures/names';
import {
  CIV_INTERVAL, PLANT_ENERGY, TRIBE_MIN_FOUNDERS, TRIBE_MIN_INT, TRIBE_MIN_SOCIAL, TICKS_PER_DAY, TICKS_PER_SEASON,
} from '../constants';
import type { GoalId, Job, PolicyKey, SettlementDetail, SettlementView, SimEvent, TribeView } from '../types';
import { genomeToRecord } from '../creatures/genome';
import { dist2d } from '../mathutil';
import {
  Settlement, Stock, newSettlement, updateEconomy, evaluateLifecycle, deteriorate, abandon, resettle, residualClaim,
  settlementView, structurePoints, housingOf, settlementEvent, currentEra, TIER_NAMES, STATE_LABEL, PASSES_PER_DAY,
} from './settlements';
import { MigrationGroup, planMigration, updateGroups, makeRefugees, groupView } from './migration';
import { updateStrategy, defaultPolicies, goalW, pol, GOAL_LABEL } from './strategy';

export type { Settlement, Stock };

export interface Culture { militarism: number; openness: number; scholarship: number; agrarian: number }

export interface Tribe {
  id: number;
  name: string;
  speciesId: number;
  hue: number;
  founded: number;
  leaderId: number;
  leaderName: string;
  leaderSince: number;
  population: number;
  peak: number;
  settlementIds: number[];
  capitalId: number;
  research: number;
  techs: string[];
  current: string | null;
  culture: Culture;
  archetype: string;
  government: string;
  traditions: string[];
  collapsed: boolean;
  collapsedTick: number | null;
  homeX: number;
  homeY: number;
  nomadicSince: number;
  waterSpots: { x: number; y: number }[];
  lang: number[];
  territory: number;
  history: number[];
  kills: number;
  losses: number;
  stability: number;
  lowStabilitySince: number;
  instability: string;
  instabilityCause: number;
  goals: GoalId[];
  policies: Record<PolicyKey, number>;
  pendingPolicies: { key: PolicyKey; value: number; effectiveAt: number }[];
  policyHistory: { tick: number; key: PolicyKey; value: number }[];
  parentTribeId: number;
  successors: number[];
  lastSecession: number;
  lastExpansion: number;
  lastGoalEvent: number;
  capitalLostTick: number;
  popAtCapitalLoss: number;
  recentLossTick: number;
  declining: boolean;
  declinePeak: number;
  lowPoint: number;
  migIn: number;
  migOut: number;
  foodSecurity: number;
  military: number;
  economy: string;
  events: number[];
}

interface DiploRel {
  a: number;
  b: number;
  value: number;
  status: 'peace' | 'alliance' | 'war';
  since: number;
  traded: boolean;
  causeId?: number;
}

export interface CivCounters {
  founded: number; colonies: number; abandoned: number; resettled: number; groups: number; migrants: number;
  arrived: number; failed: number; lost: number; stranded: number; refugees: number; refugeeGroups: number; colonistGroups: number;
  secessions: number; declines: number; recoveries: number; migrantDeaths: number; borderShifts: number;
}

const CAPACITY = [14, 32, 70, 150];
const TRADITIONS: { name: string; w: (t: Tribe, ctx: { cold: boolean; coastal: boolean; mountain: boolean }) => number }[] = [
  { name: 'Ancestor Veneration', w: () => 1 },
  { name: 'Sun Worship', w: (_, c) => (c.cold ? 0.5 : 1.2) },
  { name: 'Moon Rites', w: () => 0.8 },
  { name: 'Festival of First Rain', w: (t) => 0.5 + t.culture.agrarian },
  { name: 'Warrior Trials', w: (t) => t.culture.militarism * 2 },
  { name: 'Stone Circles', w: (_, c) => (c.mountain ? 1.5 : 0.4) },
  { name: 'Sky Burials', w: (_, c) => (c.mountain ? 1.2 : 0.3) },
  { name: 'River Blessings', w: () => 0.8 },
  { name: 'Hunt Feasts', w: (t) => t.culture.militarism + 0.3 },
  { name: 'Storytelling Nights', w: (t) => t.culture.scholarship + t.culture.openness },
  { name: 'Star Gazing', w: (t) => t.culture.scholarship * 1.5 },
  { name: 'Winter Fires', w: (_, c) => (c.cold ? 2 : 0.2) },
  { name: 'Harvest Festival', w: (t) => t.culture.agrarian * 2 },
  { name: 'Pilgrimage to the Peaks', w: (_, c) => (c.mountain ? 1.3 : 0.2) },
  { name: 'Sea Offerings', w: (_, c) => (c.coastal ? 2 : 0) },
  { name: 'Gift Exchanges', w: (t) => t.culture.openness * 1.5 },
];

const qbuf: Creature[] = [];
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function emptyCounters(): CivCounters {
  return {
    founded: 0, colonies: 0, abandoned: 0, resettled: 0, groups: 0, migrants: 0, arrived: 0, failed: 0, lost: 0, stranded: 0, refugees: 0,
    refugeeGroups: 0, colonistGroups: 0, secessions: 0, declines: 0, recoveries: 0, migrantDeaths: 0, borderShifts: 0,
  };
}

export class CivManager {
  tribes: Tribe[] = [];
  settlements: Settlement[] = [];
  tribeById = new Map<number, Tribe>();
  settlementById = new Map<number, Settlement>();
  relations = new Map<string, DiploRel>();
  groups: MigrationGroup[] = [];
  groupById = new Map<number, MigrationGroup>();
  nextTribeId = 1;
  nextSettlementId = 1;
  nextGroupId = 1;
  pass = 0;
  firstTech = new Set<string>();
  firstTier = new Set<number>();
  territoryDirty = true;
  counters: CivCounters = emptyCounters();
  /** Tribe id -> id of the event describing its latest loss (for causal links). */
  lastLossEvent = new Map<number, number>();
  /** Border-shift reporting throttle: "a:b" -> tick. */
  borderReported = new Map<string, number>();
  // Transient (rebuilt every pass): residents per settlement, homeless members per tribe.
  residents = new Map<number, Creature[]>();
  homeless = new Map<number, Creature[]>();

  tribe(id: number): Tribe | undefined { return this.tribeById.get(id); }
  /** Active (inhabited) settlement, or undefined. */
  settlement(id: number): Settlement | undefined {
    const s = this.settlementById.get(id);
    return s && !s.destroyed ? s : undefined;
  }
  group(id: number): MigrationGroup | undefined { return this.groupById.get(id); }

  activeTribes(): Tribe[] { return this.tribes.filter((t) => !t.collapsed); }
  activeSettlements(): Settlement[] { return this.settlements.filter((s) => !s.destroyed); }

  hasTech(tribeId: number, tech: string): boolean {
    const t = this.tribeById.get(tribeId);
    return !!t && t.techs.includes(tech);
  }

  private key(a: number, b: number): string { return a < b ? `${a}:${b}` : `${b}:${a}`; }
  rel(a: number, b: number): DiploRel | undefined { return this.relations.get(this.key(a, b)); }
  atWar(a: number, b: number): boolean { return this.rel(a, b)?.status === 'war'; }

  setRelation(a: number, b: number, value: number, status: DiploRel['status'], tick: number): void {
    this.relations.set(this.key(a, b), { a: Math.min(a, b), b: Math.max(a, b), value, status, since: tick, traded: false });
  }

  hasEnemies(tribeId: number): boolean {
    for (const r of this.relations.values()) if (r.status === 'war' && (r.a === tribeId || r.b === tribeId)) return true;
    return false;
  }

  enemiesOf(tribeId: number): number[] {
    const out: number[] = [];
    for (const r of this.relations.values()) if (r.status === 'war' && (r.a === tribeId || r.b === tribeId)) out.push(r.a === tribeId ? r.b : r.a);
    return out;
  }

  alliesOf(tribeId: number): number[] {
    const out: number[] = [];
    for (const r of this.relations.values()) if (r.status === 'alliance' && (r.a === tribeId || r.b === tribeId)) out.push(r.a === tribeId ? r.b : r.a);
    return out;
  }

  /** A neighbouring rival noticeably weaker than this tribe (for conquest goals). */
  weakerNeighbor(sim: Simulation, t: Tribe): boolean {
    for (const o of this.tribes) {
      if (o.collapsed || o.id === t.id) continue;
      const r = this.rel(t.id, o.id);
      if (!r || r.status === 'alliance') continue;
      if (dist2d(o.homeX - t.homeX, o.homeY - t.homeY) < 45 && o.military < t.military * 0.6) return true;
    }
    return false;
  }

  /** Push an event attributed to a tribe and keep it in the tribe's recent history. */
  tribeEvent(sim: Simulation, t: Tribe, e: { cat: SimEvent['cat']; level: 1 | 2 | 3; title: string; text: string; causeId?: number }): SimEvent {
    const ev = sim.events.push({ ...e, tick: sim.tick, x: t.homeX, y: t.homeY, tribeId: t.id });
    t.events.push(ev.id);
    if (t.events.length > 30) t.events.shift();
    return ev;
  }

  shelterFor(c: Creature): number {
    if (c.homeId < 0) return 0;
    const s = this.settlement(c.homeId);
    if (!s) return 0;
    if (Math.abs(s.x - c.x) + Math.abs(s.y - c.y) > 3 + s.tier * 1.5) return 0;
    return Math.min(0.95, 0.45 + s.tier * 0.12 + (this.hasTech(c.tribeId, 'fire') ? 0.4 : 0));
  }

  medicineFactor(c: Creature): number {
    return c.tribeId >= 0 && this.hasTech(c.tribeId, 'medicine') ? 1.6 : 1;
  }

  combatBonusFor(t: Tribe): number {
    let b = 1;
    if (t.techs.includes('hunting')) b += 0.35;
    if (t.techs.includes('bronze')) b += 0.5;
    if (t.traditions.includes('Warrior Trials')) b += 0.1;
    return b;
  }

  combatBonus(c: Creature): number {
    if (c.tribeId < 0) return 1;
    const t = this.tribeById.get(c.tribeId);
    return t ? this.combatBonusFor(t) : 1;
  }

  defenseBonus(c: Creature): number {
    if (c.tribeId < 0) return 1;
    let b = this.hasTech(c.tribeId, 'bronze') ? 1.2 : 1;
    if (c.homeId >= 0) {
      const s = this.settlement(c.homeId);
      if (s && s.walls && s.wallCondition > 0.3 && Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < 6) b *= 1.6;
    }
    return b;
  }

  knownWater(c: Creature): { x: number; y: number } | null {
    const t = this.tribeById.get(c.tribeId);
    if (!t || !t.techs.includes('language') || t.waterSpots.length === 0) return null;
    let best = t.waterSpots[0], bd = Infinity;
    for (const w of t.waterSpots) {
      const d = Math.abs(w.x - c.x) + Math.abs(w.y - c.y);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  shareWater(c: Creature): void {
    const t = this.tribeById.get(c.tribeId);
    if (!t) return;
    if (t.waterSpots.some((w) => Math.abs(w.x - c.x) + Math.abs(w.y - c.y) < 10)) return;
    t.waterSpots.push({ x: c.x, y: c.y });
    if (t.waterSpots.length > 8) t.waterSpots.shift();
  }

  /** Eat from the home settlement's stores. */
  eatFromStore(c: Creature): void {
    const s = c.homeId >= 0 ? this.settlement(c.homeId) : undefined;
    if (!s) return;
    const need = (c.maxEnergy * 0.95 - c.energy) / (PLANT_ENERGY * 0.9);
    const take = Math.max(0, Math.min(s.stock.food, need));
    s.stock.food -= take;
    s.consAcc += take;
    c.energy += take * PLANT_ENERGY * 0.9;
  }

  /** Called by Simulation.kill for tribe members and migrants. */
  onDeath(c: Creature, killed: boolean): void {
    if (c.migrationId >= 0) {
      const g = this.groupById.get(c.migrationId);
      if (g) { g.deaths++; this.counters.migrantDeaths++; }
    }
    if (killed && c.homeId >= 0) {
      const s = this.settlementById.get(c.homeId);
      if (s && !s.destroyed) s.threat += 0.12;
    }
  }

  // ---------------------------------------------------------------- Update

  update(sim: Simulation): void {
    this.pass++;
    this.refreshMembership(sim);
    this.formTribes(sim);
    for (const s of this.settlements) {
      if (s.destroyed) { deteriorate(sim, this, s); continue; }
      updateEconomy(sim, this, s, this.residents.get(s.id) ?? []);
      evaluateLifecycle(sim, this, s);
    }
    for (const t of this.tribes) {
      if (t.collapsed) continue;
      this.research(sim, t);
      this.manageSettlements(sim, t);
      if ((this.pass + t.id) % 10 === 0) updateStrategy(sim, this, t);
      if ((this.pass + t.id) % 4 === 0) planMigration(sim, this, t);
      if (this.pass % 10 === 0) {
        t.history.push(t.population);
        if (t.history.length > 300) t.history.shift();
      }
    }
    updateGroups(sim, this);
    if (this.pass % 5 === 0) this.diplomacy(sim);
    if (this.pass % 4 === 0 || this.territoryDirty) this.computeTerritory(sim);
  }

  private refreshMembership(sim: Simulation): void {
    const members = new Map<number, Creature[]>();
    this.residents.clear();
    this.homeless.clear();
    for (const s of this.settlements) s.population = 0;
    for (const c of sim.creatures) {
      if (!c.alive || c.tribeId < 0) continue;
      const t = this.tribeById.get(c.tribeId);
      if (!t || t.collapsed) { c.tribeId = -1; c.homeId = -1; c.migrationId = -1; c.job = null; continue; }
      let m = members.get(c.tribeId);
      if (!m) { m = []; members.set(c.tribeId, m); }
      m.push(c);
      if (c.migrationId >= 0) {
        if (this.groupById.has(c.migrationId)) { c.homeId = -1; continue; }
        c.migrationId = -1;
      }
      if (c.homeId >= 0) {
        const s = this.settlement(c.homeId);
        if (!s || s.tribeId !== c.tribeId) c.homeId = -1;
      }
      if (c.homeId < 0 && t.settlementIds.length > 0) {
        // Members close to one of their settlements simply move in; distant ones regroup and travel.
        let best: Settlement | undefined, bd = Infinity;
        for (const sid of t.settlementIds) {
          const s = this.settlement(sid);
          if (!s) continue;
          const d = Math.abs(s.x - c.x) + Math.abs(s.y - c.y);
          if (d < bd) { bd = d; best = s; }
        }
        if (best && bd < 25) c.homeId = best.id;
      }
      if (c.homeId >= 0) {
        const s = this.settlementById.get(c.homeId)!;
        s.population++;
        let r = this.residents.get(s.id);
        if (!r) { r = []; this.residents.set(s.id, r); }
        r.push(c);
      } else {
        let h = this.homeless.get(t.id);
        if (!h) { h = []; this.homeless.set(t.id, h); }
        h.push(c);
      }
    }
    for (const t of this.tribes) {
      if (t.collapsed) continue;
      const m = members.get(t.id) ?? [];
      t.population = m.length;
      if (t.population > t.peak) t.peak = t.population;
      t.settlementIds = t.settlementIds.filter((id) => { const s = this.settlement(id); return !!s && s.tribeId === t.id; });
      const leader = sim.byId.get(t.leaderId);
      if (m.length === 0) {
        this.collapse(sim, t, 'its last member perished');
        continue;
      }
      if (m.length < 2 || (m.length < 3 && t.settlementIds.length === 0 && sim.tick - t.founded > TICKS_PER_DAY * 10)) {
        for (const c of m) { c.tribeId = -1; c.homeId = -1; c.migrationId = -1; c.job = null; }
        this.collapse(sim, t, 'its few survivors scattered');
        continue;
      }
      if (!leader || !leader.alive || leader.tribeId !== t.id) {
        let best = m[0], bs = -Infinity;
        for (const c of m) {
          // Experience counts, but a people looks for a leader with years ahead of them.
          const life = c.age / c.lifespan;
          const s = c.intelligence * 2 + Math.min(life, 0.5) * 1.2 - Math.max(0, life - 0.75) * 3 + c.strength * 0.3 + (c.mature ? 1 : -5) + (c.homeId === t.capitalId ? 0.5 : 0);
          if (s > bs) { bs = s; best = c; }
        }
        const old = t.leaderName;
        t.leaderId = best.id;
        t.leaderName = best.name;
        t.leaderSince = sim.tick;
        best.title = 'Leader';
        best.remember(sim.tick, 'leader', `Became leader of ${t.name}`);
        if (t.population >= 12) {
          this.tribeEvent(sim, t, { cat: 'civ', level: 1, title: 'New leader', text: `${best.name} succeeds ${old} as leader of ${t.name}.` });
        }
      }
      const cap = this.settlement(t.capitalId) ?? (t.settlementIds.length ? this.settlement(t.settlementIds[0]) : undefined);
      if (cap) { t.homeX = cap.x; t.homeY = cap.y; }
      else {
        const leaderC = sim.byId.get(t.leaderId);
        if (leaderC) { t.homeX = leaderC.x; t.homeY = leaderC.y; }
      }
    }
  }

  private collapse(sim: Simulation, t: Tribe, reason: string): void {
    t.collapsed = true;
    t.collapsedTick = sim.tick;
    t.population = 0;
    for (const sid of t.settlementIds.slice()) {
      const s = this.settlementById.get(sid);
      if (s && !s.destroyed) abandon(sim, this, s, `${t.name} vanished`, -1, 'civ', false);
    }
    for (const g of this.groups.filter((x) => x.tribeId === t.id)) {
      for (const id of g.members) { const c = sim.byId.get(id); if (c) c.migrationId = -1; }
      this.groups = this.groups.filter((x) => x !== g);
      this.groupById.delete(g.id);
    }
    for (const r of this.relations.values()) if (r.a === t.id || r.b === t.id) r.status = 'peace';
    const big = t.peak >= 10 || t.capitalId >= 0;
    const ev = this.tribeEvent(sim, t, {
      cat: 'civ', level: big ? 3 : 1,
      title: big ? 'Civilization collapsed' : 'Band dispersed',
      text: big ? `${t.name} has collapsed — ${reason}. At its height it numbered ${t.peak}.` : `${t.name} is no more: ${reason}.`,
      causeId: this.lastLossEvent.get(t.id) ?? (t.instabilityCause >= 0 ? t.instabilityCause : undefined),
    });
    // Each town it left behind remembers why it fell silent.
    for (const s of this.settlements) {
      if (s.destroyed && s.tribeId === t.id && s.destroyedTick === sim.tick) { s.events.push(ev.id); s.lastCause = ev.id; }
    }
    this.territoryDirty = true;
  }

  private formTribes(sim: Simulation): void {
    const cs = sim.creatures;
    if (cs.length === 0) return;
    const stride = Math.max(1, Math.floor(cs.length / 80));
    const off = this.pass % stride;
    for (let i = off; i < cs.length; i += stride) {
      const c = cs[i];
      if (!c.alive || !c.mature) continue;
      if (c.tribeId >= 0) continue;
      // Assimilation into a nearby settlement of the same species.
      if (c.intelligence > 0.3) {
        for (const s of this.settlements) {
          if (s.destroyed) continue;
          const t = this.tribeById.get(s.tribeId)!;
          if (t.speciesId !== c.speciesId) continue;
          if (Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < 6 + s.tier * 2 && sim.rng.chance(0.3)) {
            c.tribeId = t.id; c.homeId = s.id;
            s.population++; t.population++;
            c.remember(sim.tick, 'joined', `Joined ${t.name} at ${s.name}`);
            break;
          }
        }
        if (c.tribeId >= 0) continue;
      }
      if (c.intelligence < TRIBE_MIN_INT || c.sociability < TRIBE_MIN_SOCIAL) continue;
      const n = sim.spatial.query(c.x, c.y, 7, qbuf, 40, c);
      const founders: Creature[] = [c];
      for (let k = 0; k < n && founders.length < 10; k++) {
        const o = qbuf[k];
        if (o.speciesId === c.speciesId && o.tribeId < 0 && o.mature && o.intelligence >= TRIBE_MIN_INT - 0.08 && o.sociability >= TRIBE_MIN_SOCIAL - 0.15) founders.push(o);
      }
      if (founders.length >= TRIBE_MIN_FOUNDERS) this.createTribe(sim, founders);
    }
  }

  /** Create a tribe record (shared by new tribes and successor states). */
  createTribeRecord(sim: Simulation, o: { name: string; speciesId: number; lang: number[]; culture: Culture; leader: Creature | null; founderX: number; founderY: number }): Tribe {
    const t: Tribe = {
      id: this.nextTribeId++,
      name: o.name,
      speciesId: o.speciesId,
      hue: (this.nextTribeId * 0.618034) % 1,
      founded: sim.tick,
      leaderId: o.leader?.id ?? -1,
      leaderName: o.leader?.name ?? '—',
      leaderSince: sim.tick,
      population: 0,
      peak: 0,
      settlementIds: [],
      capitalId: -1,
      research: 0,
      techs: [],
      current: null,
      culture: o.culture,
      archetype: archetypeOf(o.culture),
      government: 'Nomadic Band',
      traditions: [],
      collapsed: false,
      collapsedTick: null,
      homeX: o.founderX,
      homeY: o.founderY,
      nomadicSince: sim.tick,
      waterSpots: [],
      lang: o.lang,
      territory: 0,
      history: [],
      kills: 0,
      losses: 0,
      stability: 0.7,
      lowStabilitySince: -1,
      instability: '',
      instabilityCause: -1,
      goals: [],
      policies: defaultPolicies(),
      pendingPolicies: [],
      policyHistory: [],
      parentTribeId: -1,
      successors: [],
      lastSecession: -1e9,
      lastExpansion: -1e9,
      lastGoalEvent: -1e9,
      capitalLostTick: -1e9,
      popAtCapitalLoss: 0,
      recentLossTick: -1e9,
      declining: false,
      declinePeak: 0,
      lowPoint: 0,
      migIn: 0,
      migOut: 0,
      foodSecurity: 0.6,
      military: 0,
      economy: 'Stable',
      events: [],
    };
    this.tribes.push(t);
    this.tribeById.set(t.id, t);
    return t;
  }

  createTribe(sim: Simulation, founders: Creature[]): Tribe {
    const rng = sim.rng;
    const sp = sim.species.get(founders[0].speciesId);
    const lang = sp?.lang ?? [0, 1, 2, 3, 4, 5];
    const avg = (f: (c: Creature) => number) => founders.reduce((s, c) => s + f(c), 0) / founders.length;
    const leader = founders.reduce((a, b) => (b.intelligence > a.intelligence ? b : a));
    const tile = sim.world.tileAt(leader.x, leader.y);
    const culture: Culture = {
      militarism: clamp(avg((c) => c.aggression) * 1.2 - 0.05 + rng.gauss(0, 0.12), 0, 1),
      openness: clamp(avg((c) => c.sociability) * 0.7 + (1 - avg((c) => c.aggression)) * 0.3 + rng.gauss(0, 0.12) - 0.05, 0, 1),
      scholarship: clamp(avg((c) => c.intelligence) * 0.8 + avg((c) => c.curiosity) * 0.4 - 0.3 + rng.gauss(0, 0.12), 0, 1),
      agrarian: clamp(sim.world.fertility[tile] * 0.6 + rng.gauss(0.2, 0.15), 0, 1),
    };
    const t = this.createTribeRecord(sim, { name: tribeName(rng, lang), speciesId: founders[0].speciesId, lang, culture, leader, founderX: leader.x, founderY: leader.y });
    t.population = founders.length;
    t.peak = founders.length;
    this.addTradition(sim, t);
    for (const c of founders) {
      c.tribeId = t.id;
      c.remember(sim.tick, 'tribe', c === leader ? `Founded ${t.name}` : `Joined ${t.name}, led by ${leader.name}`);
      if (c.waterX >= 0) t.waterSpots.push({ x: c.waterX, y: c.waterY });
    }
    leader.title = 'Founder';
    this.tribeEvent(sim, t, {
      cat: 'civ', level: this.tribes.length === 1 ? 3 : 2,
      title: this.tribes.length === 1 ? 'The first tribe' : 'A tribe has formed',
      text: `${founders.length} ${sp?.common ?? 'creatures'} gathered around ${leader.name} and became ${t.name} — a ${t.archetype.toLowerCase()} people who practice ${t.traditions[0]}.`,
    });
    return t;
  }

  private addTradition(sim: Simulation, t: Tribe): void {
    const w = sim.world;
    const i = w.tileAt(t.homeX, t.homeY);
    const ctx = {
      cold: w.baseTemp[i] < 6,
      coastal: w.waterDist[i] < 6 || isCoastal(sim, t.homeX, t.homeY),
      mountain: (w.elevation[i] - w.seaLevel) / (1 - w.seaLevel) > 0.3,
    };
    const opts = TRADITIONS.filter((o) => !t.traditions.includes(o.name));
    const total = opts.reduce((s, o) => s + o.w(t, ctx), 0);
    let r = sim.rng.next() * total;
    for (const o of opts) {
      r -= o.w(t, ctx);
      if (r <= 0) { t.traditions.push(o.name); return; }
    }
  }

  private research(sim: Simulation, t: Tribe): void {
    if (!t.current) {
      const opts = availableTechs(t.techs);
      if (opts.length === 0) return;
      const coastal = isCoastal(sim, t.homeX, t.homeY);
      const cold = sim.world.baseTemp[sim.world.tileAt(t.homeX, t.homeY)] < 8;
      let total = 0;
      const ws = opts.map((o) => {
        const a = o.affinity;
        const w = 0.3 + (a.militarism ?? 0) * t.culture.militarism + (a.openness ?? 0) * t.culture.openness +
          (a.scholarship ?? 0) * t.culture.scholarship + (a.agrarian ?? 0) * t.culture.agrarian +
          (a.coastal ?? 0) * (coastal ? 1 : 0) + (a.cold ?? 0) * (cold ? 1 : 0);
        total += w;
        return w;
      });
      let r = sim.rng.next() * total;
      for (let k = 0; k < opts.length; k++) { r -= ws[k]; if (r <= 0) { t.current = opts[k].id; break; } }
      if (!t.current) t.current = opts[0].id;
    }
    let pts = 0;
    for (const c of sim.creatures) {
      if (c.tribeId === t.id && c.mature) pts += c.intelligence * c.intelligence;
    }
    pts = Math.pow(pts, 0.8) * 0.3 * (0.6 + t.culture.scholarship) * (t.techs.includes('writing') ? 1.5 : 1) * (t.settlementIds.length > 0 ? 1.25 : 1);
    if (t.traditions.includes('Star Gazing') || t.traditions.includes('Storytelling Nights')) pts *= 1.1;
    pts *= 1 + 0.3 * goalW(t, 'research') + 0.25 * pol(t, 'research') - 0.08 * Math.max(0, pol(t, 'military')) - 0.08 * Math.max(0, pol(t, 'stability'));
    t.research += pts;
    const def = TECH_BY_ID.get(t.current!)!;
    if (t.research >= def.cost) {
      t.research -= def.cost;
      t.techs.push(def.id);
      t.current = null;
      const first = !this.firstTech.has(def.id);
      this.firstTech.add(def.id);
      this.tribeEvent(sim, t, {
        cat: 'civ', level: first ? 2 : 1,
        title: first ? `Discovery: ${def.name}` : `${def.name} learned`,
        text: first ? `${t.name} discovered ${def.name} — the first in the world. ${def.description}` : `${t.name} have learned ${def.name}.`,
      });
      this.updateGovernment(sim, t);
    }
  }

  private updateGovernment(sim: Simulation, t: Tribe): void {
    let g = t.government;
    if (t.settlementIds.length === 0) g = 'Nomadic Band';
    else if (t.techs.includes('philosophy')) {
      g = t.culture.openness >= 0.55 ? 'Republic' : t.culture.militarism >= 0.5 && t.settlementIds.length >= 3 ? 'Empire' : 'Theocracy';
    } else if (t.techs.includes('governance')) g = t.culture.militarism > t.culture.openness ? 'Monarchy' : 'Council of Elders';
    else g = 'Chiefdom';
    if (g !== t.government) {
      const old = t.government;
      t.government = g;
      if (old !== 'Nomadic Band' || g !== 'Chiefdom') {
        this.tribeEvent(sim, t, { cat: 'civ', level: 2, title: 'New government', text: `${t.name} transformed from ${aOrAn(old)} into ${aOrAn(g)}.` });
      }
    }
  }

  // ---------------------------------------------------------------- Sites

  siteScore(sim: Simulation, x: number, y: number, tribeId: number): number {
    const w = sim.world;
    if (!w.inBounds(x, y)) return -10;
    const i = w.tileAt(x, y);
    if (!w.isLand(i) || w.biome[i] === 16 || w.biome[i] === 14 || w.biome[i] === 15) return -10;
    let fert = 0, cnt = 0;
    for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) {
      if (!w.inBounds(x + dx, y + dy)) continue;
      fert += w.fertility[w.tileAt(x + dx, y + dy)];
      cnt++;
    }
    let s = fert / Math.max(1, cnt);
    const wd = w.waterDist[i];
    s += wd <= 2 ? 0.8 : wd <= 5 ? 0.4 : wd <= 9 ? 0 : -0.6;
    const owner = w.territory[i];
    if (owner >= 0 && owner !== tribeId) s -= 2;
    for (const o of this.settlements) {
      if (o.destroyed) continue;
      const d = dist2d(o.x - x, o.y - y);
      if (d < 11) s -= 3;
    }
    return s;
  }

  /** Founding requirements: land, fresh water within reach, room, no hostile claim. */
  siteValid(sim: Simulation, t: Tribe, x: number, y: number): boolean {
    const w = sim.world;
    if (!w.inBounds(x, y)) return false;
    const i = w.tileAt(x, y);
    if (!w.isLand(i) || w.biome[i] >= 14) return false;
    if (w.waterDist[i] > 6) return false;
    const owner = w.territory[i];
    if (owner >= 0 && owner !== t.id) return false;
    for (const o of this.settlements) if (!o.destroyed && dist2d(o.x - x, o.y - y) < 8) return false;
    if (this.nearRecentRuin(sim, t, x, y)) return false;
    return true;
  }

  /**
   * Whether a people may resettle an abandoned place. A people does not return to a town it abandoned
   * itself within the last season (no abandon/resettle oscillation); land with nothing left is a fresh site.
   */
  canResettle(sim: Simulation, t: Tribe, s: Settlement): boolean {
    if (!s.destroyed || s.reclaimed) return false;
    return !(currentEra(s).tribeId === t.id && sim.tick - s.destroyedTick < TICKS_PER_SEASON);
  }

  /** True when a site sits on a place this people abandoned too recently to return to. */
  nearRecentRuin(sim: Simulation, t: Tribe, x: number, y: number): boolean {
    for (const s of this.settlements) {
      if (s.destroyed && !s.reclaimed && !this.canResettle(sim, t, s) && dist2d(s.x - x, s.y - y) < 6) return true;
    }
    return false;
  }

  ruinNear(x: number, y: number, r: number, sim?: Simulation, t?: Tribe): Settlement | undefined {
    let best: Settlement | undefined, bd = r;
    for (const s of this.settlements) {
      if (!s.destroyed || s.reclaimed) continue;
      if (sim && t && !this.canResettle(sim, t, s)) continue;
      const d = dist2d(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Strategic site search: fertility, water, building material, ruins to reuse, distance. */
  findSite(sim: Simulation, t: Tribe, cx: number, cy: number, rMin: number, rMax: number, preferRuins: boolean): { x: number; y: number; ruinId: number } | null {
    const rng = sim.rng, w = sim.world;
    const cands: { x: number; y: number; ruinId: number }[] = [];
    if (preferRuins) {
      for (const s of this.settlements) {
        if (!this.canResettle(sim, t, s)) continue;
        const d = dist2d(s.x - cx, s.y - cy);
        if (d >= rMin && d <= rMax + 12) cands.push({ x: s.x, y: s.y, ruinId: s.id });
      }
    }
    for (let k = 0; k < 18; k++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(rMin, rMax);
      cands.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, ruinId: -1 });
    }
    let best: { x: number; y: number; ruinId: number } | null = null, bs = 0.55;
    for (const c of cands) {
      if (!this.siteValid(sim, t, c.x, c.y)) continue;
      let s = this.siteScore(sim, c.x, c.y, t.id) - dist2d(c.x - cx, c.y - cy) * 0.012;
      const i = w.tileAt(c.x, c.y);
      // Building material within reach.
      let wood = 0, stone = 0;
      for (let dy = -6; dy <= 6; dy += 3) for (let dx = -6; dx <= 6; dx += 3) {
        if (!w.inBounds(c.x + dx, c.y + dy)) continue;
        const b = BIOMES[w.biome[w.tileAt(c.x + dx, c.y + dy)]];
        wood = Math.max(wood, b.wood); stone = Math.max(stone, b.stone);
      }
      s += wood * 0.25 + stone * 0.1 + (w.river[i] ? 0.15 : 0);
      if (c.ruinId >= 0) { const r = this.settlementById.get(c.ruinId)!; s += 0.35 + Math.min(0.4, (r.stone + r.wood) * 0.02); }
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }

  /** Found a new settlement, or resettle ruins, with the given colonists as residents. */
  establish(sim: Simulation, t: Tribe, x: number, y: number, colonists: Creature[], parent: Settlement | null, how: 'founded' | 'colonized' | 'refuge', causeId: number, ruinId = -1): Settlement {
    const ruin = ruinId >= 0 ? this.settlementById.get(ruinId) : this.ruinNear(x, y, 4, sim, t);
    let s: Settlement;
    if (ruin && this.canResettle(sim, t, ruin)) {
      s = ruin;
      resettle(sim, this, s, t, 'resettled', causeId);
      if (parent) s.parentId = parent.id;
    } else {
      s = this.foundSettlement(sim, t, x, y, parent, how, causeId);
    }
    for (const c of colonists) {
      c.homeId = s.id;
      c.migrationId = -1;
      c.remember(sim.tick, 'settle', parent ? `Left ${parent.name} to settle ${s.name}` : `Helped found ${s.name}`);
    }
    s.population = colonists.length;
    if (t.capitalId < 0 || !this.settlement(t.capitalId)) t.capitalId = s.id;
    if (t.government === 'Nomadic Band') t.government = 'Chiefdom';
    return s;
  }

  foundSettlement(sim: Simulation, t: Tribe, x: number, y: number, parent: Settlement | null, how: 'founded' | 'colonized' | 'refuge', causeId: number): Settlement {
    const s = newSettlement(this.nextSettlementId++, t, settlementName(sim.rng, t.lang), x, y, sim.tick, how, parent?.id ?? -1);
    this.settlements.push(s);
    this.settlementById.set(s.id, s);
    t.settlementIds.push(s.id);
    this.counters.founded++;
    if (parent) this.counters.colonies++;
    const w = sim.world;
    const i = w.tileAt(x, y);
    const by = w.river[i] > 0 || w.waterDist[i] <= 2 ? (w.lake[i] || w.biome[i] === 3 ? 'on a lakeshore' : 'by the river') : isCoastal(sim, x, y) ? 'on the coast' : `in the ${BIOMES[w.biome[i]].name.toLowerCase()}`;
    const firstEver = this.settlements.length === 1;
    settlementEvent(sim, s, {
      cat: 'settlement', level: firstEver ? 3 : 2,
      title: firstEver ? 'The first settlement' : how === 'refuge' ? 'A refuge founded' : parent ? 'New colony' : 'Settlement established',
      text: how === 'refuge' ? `Refugees from ${parent?.name ?? 'a fallen town'} founded ${s.name} ${by}.`
        : parent ? `Colonists from ${parent.name} founded ${s.name} ${by}.` : `${t.name} settled down and founded ${s.name} ${by}.${firstEver ? ' History has begun.' : ''}`,
      tribeId: t.id, causeId: causeId >= 0 ? causeId : undefined,
    });
    this.territoryDirty = true;
    return s;
  }

  private manageSettlements(sim: Simulation, t: Tribe): void {
    const rng = sim.rng;
    const w = sim.world;
    // Nomadic bands look for a home (ruins included); the band travels with its leader.
    if (t.settlementIds.length === 0) {
      if (t.population < 4) return;
      const leader = sim.byId.get(t.leaderId);
      if (!leader || leader.migrationId >= 0) return;
      let bx = leader.x, by = leader.y, bs = this.siteScore(sim, leader.x, leader.y, t.id);
      for (let k = 0; k < 6; k++) {
        const x = leader.x + rng.range(-8, 8), y = leader.y + rng.range(-8, 8);
        const s = this.siteScore(sim, x, y, t.id);
        if (s > bs) { bs = s; bx = x; by = y; }
      }
      const ruin = this.ruinNear(leader.x, leader.y, 10, sim, t);
      if (ruin && this.siteValid(sim, t, ruin.x, ruin.y) && this.siteScore(sim, ruin.x, ruin.y, t.id) + 0.5 > bs) { bx = ruin.x; by = ruin.y; bs += 0.5; }
      // Not straight back to the place they just left.
      if (this.nearRecentRuin(sim, t, bx, by)) return;
      const waited = sim.tick - t.nomadicSince;
      if (bs > 1.25 || (waited > TICKS_PER_DAY * 3 && bs > 0.7) || (waited > TICKS_PER_DAY * 8 && bs > 0.2)) {
        const band = sim.creatures.filter((c) => c.tribeId === t.id && c.alive && c.migrationId < 0 && dist2d(c.x - leader.x, c.y - leader.y) < 30);
        if (band.length >= 3) this.establish(sim, t, bx, by, band, null, 'founded', -1);
      }
      return;
    }

    const pottery = t.techs.includes('pottery');
    const has = (x: string) => t.techs.includes(x);
    for (const sid of t.settlementIds.slice()) {
      const s = this.settlement(sid);
      if (!s) continue;
      // Local spoilage and storage limits.
      s.stock.food *= pottery ? 0.9985 : 0.996;
      const cap = (30 + s.population * 14) * (pottery ? 2 : 1);
      if (s.stock.food > cap) s.stock.food = cap;
      for (const k of ['wood', 'stone', 'ore'] as const) if (s.stock[k] > 300) s.stock[k] = 300;
      if (s.health < 100) s.health = Math.min(100, s.health + 0.2);
      if (s.walls && s.wallCondition < 1) s.wallCondition = Math.min(1, s.wallCondition + 0.002);

      // Tier upgrades.
      const pts = structurePoints(s);
      let up = false;
      if (s.tier === 0 && (has('construction') || has('agriculture')) && s.population >= 9 && pts >= 10) up = true;
      else if (s.tier === 1 && has('masonry') && s.population >= 20 && pts >= 35) up = true;
      else if (s.tier === 2 && has('engineering') && s.population >= 35 && pts >= 80) up = true;
      if (up) {
        s.tier++;
        const first = !this.firstTier.has(s.tier);
        this.firstTier.add(s.tier);
        settlementEvent(sim, s, {
          cat: 'settlement', level: s.tier === 3 || first ? 3 : 2,
          title: first ? `The first ${TIER_NAMES[s.tier].toLowerCase()}` : `${s.name} grows`,
          text: `${s.name} of ${t.name} has grown into a ${TIER_NAMES[s.tier].toLowerCase()} of ${s.population}.${first ? ' Nothing like it has existed before.' : ''}`,
          tribeId: t.id,
        });
        if (t.traditions.length < 4) this.addTradition(sim, t);
        this.territoryDirty = true;
      }
      if (!s.walls && has('masonry') && s.tier >= 1 && s.stock.stone >= 40) {
        s.stock.stone -= 40;
        s.walls = true;
        s.wallCondition = 1;
        settlementEvent(sim, s, { cat: 'settlement', level: 1, title: 'Walls raised', text: `${s.name} raised stone walls.`, tribeId: t.id });
      }

      // Farms.
      if (has('agriculture')) {
        const want = 4 + s.tier * 6 + (pottery ? 2 : 0) + (pol(t, 'agriculture') > 0 ? 3 : 0);
        s.farms = s.farms.filter((f) => w.farm[f] === 1);
        for (let k = 0; k < 6 && s.farms.length < want; k++) {
          const a = rng.next() * Math.PI * 2, r = rng.range(1.5, 3.5 + s.tier);
          const x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
          if (!w.inBounds(x, y)) continue;
          const i = w.tileAt(x, y);
          if (w.isLand(i) && w.fertility[i] > 0.15 && !w.farm[i]) {
            w.farm[i] = 1;
            if (w.fertility[i] < 0.5) w.fertility[i] = 0.5; // irrigation
            s.farms.push(i);
          }
        }
      }
    }
  }

  private diplomacy(sim: Simulation): void {
    const act = this.activeTribes();
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        const d = dist2d(a.homeX - b.homeX, a.homeY - b.homeY);
        const k = this.key(a.id, b.id);
        let r = this.relations.get(k);
        if (!r) {
          if (d > 50) continue;
          r = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), value: 0, status: 'peace', since: sim.tick, traded: false };
          this.relations.set(k, r);
          const alien = a.speciesId !== b.speciesId;
          sim.events.push({ tick: sim.tick, cat: 'civ', level: alien ? 2 : 1, title: 'First contact', text: alien ? `${a.name} and ${b.name} — two different species — have met for the first time.` : `${a.name} and ${b.name} have encountered each other for the first time.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: a.id });
        }
        const same = a.speciesId === b.speciesId;
        const pressure = d < 40 ? (1 - d / 40) : 0;
        const scarcity = (scarce(this, a) + scarce(this, b)) / 2;
        let target = (a.culture.openness + b.culture.openness) * 25 - (a.culture.militarism + b.culture.militarism) * 30 +
          (same ? 10 : -12) - pressure * scarcity * 45 + (r.traded ? 15 : 0);
        target += 15 * (goalW(a, 'alliance') + goalW(b, 'alliance')) / 2 - 15 * (goalW(a, 'conquest') + goalW(b, 'conquest')) / 2 +
          8 * (pol(a, 'diplomacy') + pol(b, 'diplomacy')) / 2 - 6 * (pol(a, 'military') + pol(b, 'military')) / 2;
        // Shared ancestry tempers hostility once the bitterness of secession fades.
        if (a.parentTribeId === b.id || b.parentTribeId === a.id) target += 8;
        if (r.status === 'war') target += Math.min(40, (sim.tick - r.since) / (TICKS_PER_DAY * 2)); // war weariness
        const shared = this.enemiesOf(a.id).filter((e) => this.enemiesOf(b.id).includes(e)).length;
        target += shared * 25;
        r.value += (target - r.value) * 0.12 + sim.rng.gauss(0, 3);
        r.value = Math.max(-100, Math.min(100, r.value));

        const mil = Math.max(a.culture.militarism, b.culture.militarism);
        const warAt = -40 + 12 * Math.max(goalW(a, 'conquest'), goalW(b, 'conquest'));
        if (r.status !== 'war' && r.value < warAt && mil > 0.45) {
          r.status = 'war'; r.since = sim.tick;
          const agg = a.culture.militarism >= b.culture.militarism ? a : b;
          const def = agg === a ? b : a;
          agg.culture.militarism = Math.min(1, agg.culture.militarism + 0.05);
          const ev = sim.events.push({ tick: sim.tick, cat: 'war', level: 3, title: 'War declared', text: `${agg.name} declared war on ${def.name}${pressure > 0.3 ? ' over contested land' : ''}${scarcity > 0.5 ? ', driven by hunger' : ''}.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: agg.id });
          r.causeId = ev.id;
        } else if (r.status === 'war' && r.value > -12) {
          r.status = 'peace'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'war', level: 2, title: 'Peace treaty', text: `${a.name} and ${b.name} have made peace.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: a.id, causeId: r.causeId });
        } else if (r.status === 'peace' && r.value > 45 && Math.min(a.culture.openness, b.culture.openness) > 0.35) {
          r.status = 'alliance'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'civ', level: 2, title: 'Alliance formed', text: `${a.name} and ${b.name} have formed an alliance.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: a.id });
        } else if (r.status === 'alliance' && r.value < 10) {
          r.status = 'peace'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'civ', level: 1, title: 'Alliance dissolved', text: `The alliance between ${a.name} and ${b.name} has dissolved.`, x: a.homeX, y: a.homeY, tribeId: a.id });
        }
      }
    }
    function scarce(m: CivManager, t: Tribe): number {
      return t.population > 0 ? Math.max(0, 1 - m.foodOf(t) / (t.population * 8)) : 0;
    }
  }

  /** Total food in a tribe's settlements. */
  foodOf(t: Tribe): number {
    let f = 0;
    for (const sid of t.settlementIds) { const s = this.settlement(sid); if (s) f += s.stock.food; }
    return f;
  }

  stockOf(t: Tribe): Stock {
    const st: Stock = { food: 0, wood: 0, stone: 0, ore: 0 };
    for (const sid of t.settlementIds) {
      const s = this.settlement(sid);
      if (!s) continue;
      st.food += s.stock.food; st.wood += s.stock.wood; st.stone += s.stock.stone; st.ore += s.stock.ore;
    }
    return st;
  }

  /** Territory from settlement influence: population, tier, walls and technology; abandoned claims fade. */
  computeTerritory(sim: Simulation): void {
    this.territoryDirty = false;
    const w = sim.world;
    const terr = w.territory;
    const before = terr.slice();
    terr.fill(-1);
    const inf = new Float32Array(w.size);
    for (const t of this.tribes) t.territory = 0;
    for (const s of this.settlements) {
      const t = this.tribeById.get(s.tribeId);
      if (!t || t.collapsed) continue;
      const claim = residualClaim(sim, s);
      if (claim <= 0) continue;
      const pop = s.destroyed ? s.peak * 0.3 : s.population;
      const R = (4 + s.tier * 3.5 + Math.min(6, t.techs.length * 0.4) + Math.min(5, Math.sqrt(pop)) + (s.walls ? 1.5 : 0)) * (0.5 + 0.5 * claim);
      const x0 = Math.max(0, Math.floor(s.x - R)), x1 = Math.min(w.width - 1, Math.ceil(s.x + R));
      const y0 = Math.max(0, Math.floor(s.y - R)), y1 = Math.min(w.height - 1, Math.ceil(s.y + R));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w.width + x;
          if (!w.isLand(i)) continue;
          const d = dist2d(x + 0.5 - s.x, y + 0.5 - s.y);
          if (d > R) continue;
          const v = ((s.tier + 1) * (1 - d / R) + 0.01) * claim;
          if (v > inf[i]) { inf[i] = v; terr[i] = t.id; }
        }
      }
    }
    const transfers = new Map<string, number>();
    for (let i = 0; i < w.size; i++) {
      const o = terr[i];
      if (o >= 0) { const t = this.tribeById.get(o); if (t) t.territory++; }
      const b = before[i];
      if (b >= 0 && o >= 0 && b !== o) { const k = `${b}>${o}`; transfers.set(k, (transfers.get(k) ?? 0) + 1); }
    }
    for (const [k, n] of transfers) {
      if (n < 40) continue;
      const [from, to] = k.split('>').map(Number);
      const last = this.borderReported.get(k) ?? -1e9;
      if (sim.tick - last < TICKS_PER_DAY * 15) continue;
      this.borderReported.set(k, sim.tick);
      const a = this.tribeById.get(from), b = this.tribeById.get(to);
      if (!a || !b) continue;
      this.counters.borderShifts++;
      this.tribeEvent(sim, b, {
        cat: 'civ', level: 1, title: 'Borders shift',
        text: `${b.name} extended its reach over ${n} leagues of land once held by ${a.name}.`,
        causeId: this.lastLossEvent.get(a.id),
      });
    }
  }

  // ---------------------------------------------------------------- Jobs

  planWork(sim: Simulation, c: Creature): boolean {
    const t = this.tribeById.get(c.tribeId);
    if (!t) return false;
    const rng = sim.rng;
    const s = c.homeId >= 0 ? this.settlement(c.homeId) : undefined;
    c.action = 'work';
    c.targetId = -1;
    if (!s) {
      const leader = sim.byId.get(t.leaderId);
      if (leader && leader !== c && dist2d(leader.x - c.x, leader.y - c.y) > 4) {
        c.job = 'scout';
        c.tx = leader.x + rng.range(-2, 2); c.ty = leader.y + rng.range(-2, 2);
        c.goal = `Travelling with the band, led by ${leader.name}`;
        return true;
      }
      planExplore(sim, c, leader === c ? `Leading ${t.name} in search of a home` : 'Scouting with the band');
      c.action = 'work';
      c.job = 'scout';
      return true;
    }
    // Keep doing the current job until it is done: carrying goods home, or a build/guard/tending shift in progress.
    if (c.job && c.action === 'work') {
      if (c.carry > 0 && c.actionTicks < 500) return true;
      const shift = c.job === 'build' ? 150 : c.job === 'guard' ? 90 : c.job === 'farm' ? 160 : c.job === 'raid' || c.job === 'trade' ? 400 : 0;
      if (c.actionTicks < shift) return true;
    }

    const has = (x: string) => t.techs.includes(x);
    const needFood = clamp(1 - s.stock.food / Math.max(1, s.population * 12), 0, 1);
    const enemies = this.enemiesOf(t.id);
    const allies = this.alliesOf(t.id);
    // Treeless land (grassland, desert, tundra) builds with sod, mud brick and fieldstone instead of timber.
    const earthen = s.stock.wood < 3 && s.stock.stone < 3 && s.econ.crowding > 0.7 && localTimber(sim, s) < 0.2;
    const canBuild = s.stock.wood >= 3 || s.stock.stone >= 3 || earthen;
    const fs = 1 + 0.6 * goalW(t, 'food_security') + 0.3 * pol(t, 'agriculture');
    const build = 1 + 0.4 * goalW(t, 'grow') + 0.4 * goalW(t, 'recover') + 0.3 * goalW(t, 'expand');
    const gather = 1 + 0.3 * goalW(t, 'expand') + 0.2 * goalW(t, 'grow');
    const weights: [Job, number][] = [
      ['forage', (1 + needFood * 3) * fs],
      ['hunt', c.strength > 0.5 ? (0.25 + needFood * 1.2 + t.culture.militarism * 0.4 + (has('hunting') ? 0.8 : 0)) * fs * (1 - 0.5 * Math.max(0, pol(t, 'conservation'))) : 0],
      ['farm', has('agriculture') && s.farms.length > 0 ? (1.4 + needFood * 2 + t.culture.agrarian) * fs : 0],
      ['woodcut', (0.5 + (s.stock.wood < 30 ? 1 : 0.15)) * gather],
      ['mine', has('construction') || has('masonry') ? (0.4 + (s.stock.stone < 40 ? 0.7 : 0.1) + (has('bronze') ? 0.3 : 0)) * gather : 0],
      ['build', canBuild ? (0.8 + (structurePoints(s) < [12, 40, 90, 200][s.tier] || s.econ.crowding > 0.85 ? 1 : 0.2)) * build : 0],
      ['guard', (0.15 + t.culture.militarism * 0.5 + (enemies.length ? 1.2 : 0)) * (1 + 0.8 * goalW(t, 'defend') + 0.3 * pol(t, 'military'))],
      ['raid', enemies.length && c.strength > 0.6 && c.health > c.maxHealth * 0.6 ? Math.max(0, (0.6 + t.culture.militarism * 2.5) * (1 + 0.8 * goalW(t, 'conquest') + 0.4 * pol(t, 'military') - 0.5 * goalW(t, 'recover'))) : 0],
      ['trade', has('trade') && allies.length ? (0.3 + t.culture.openness * 1.2) * (1 + goalW(t, 'trade') + 0.6 * pol(t, 'trade')) : 0],
      ['scout', (0.1 + c.curiosity * 0.3) * (1 + 0.5 * goalW(t, 'expand'))],
    ];
    let total = 0;
    for (const [, wv] of weights) total += Math.max(0, wv);
    let r = rng.next() * total;
    let job: Job = 'forage';
    for (const [j, wv] of weights) { r -= Math.max(0, wv); if (r <= 0) { job = j; break; } }
    c.job = job;
    c.actionTicks = 0;
    return this.assignJobTarget(sim, c, t, s, job, enemies, allies);
  }

  private assignJobTarget(sim: Simulation, c: Creature, t: Tribe, s: Settlement, job: Job, enemies: number[], allies: number[]): boolean {
    const w = sim.world, rng = sim.rng;
    const sample = (radius: number, score: (i: number) => number): { x: number; y: number } | null => {
      let bx = -1, by = -1, bs = 0;
      for (let k = 0; k < 14; k++) {
        const a = rng.next() * Math.PI * 2, r = rng.range(1, radius);
        const x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
        if (!w.inBounds(x, y)) continue;
        const i = w.tileAt(x, y);
        if (!w.isLand(i)) continue;
        const sc = score(i) - r * 0.02;
        if (sc > bs) { bs = sc; bx = x; by = y; }
      }
      return bx >= 0 ? { x: bx, y: by } : null;
    };
    let p: { x: number; y: number } | null = null;
    const vegMin = 2 + Math.max(0, pol(t, 'conservation')) * 1.5;
    switch (job) {
      case 'forage':
        p = sample(12, (i) => (w.veg[i] > vegMin ? w.veg[i] : 0));
        c.goal = `Foraging for ${s.name}`;
        break;
      case 'hunt': {
        const n = sim.spatial.query(c.x, c.y, c.perception * 1.5, qbuf, 40, c);
        let prey: Creature | null = null, ps = 0;
        const limit = c.effSize * (1.3 + (t.techs.includes('hunting') ? 0.7 : 0));
        for (let k = 0; k < n; k++) {
          const o = qbuf[k];
          if (o.speciesId === c.speciesId || o.tribeId >= 0 || o.effSize > limit || o.meatEff > 0.5) continue;
          if (o.strength > c.strength * (t.techs.includes('hunting') ? 1.6 : 1.1) || o.aggression > 0.6) continue; // too dangerous
          const sc = o.effSize / (1 + dist2d(o.x - c.x, o.y - c.y));
          if (sc > ps) { ps = sc; prey = o; }
        }
        if (prey) {
          c.action = 'hunt';
          c.targetId = prey.id;
          c.goal = `Hunting ${prey.name} for ${s.name}`;
          return true;
        }
        p = sample(14, (i) => (w.veg[i] > vegMin ? w.veg[i] : 0));
        c.job = 'forage';
        c.goal = `Foraging for ${s.name} (no game nearby)`;
        break;
      }
      case 'farm': {
        const f = s.farms[rng.int(0, s.farms.length - 1)];
        p = { x: (f % w.width) + 0.5, y: Math.floor(f / w.width) + 0.5 };
        c.goal = `Tending the fields of ${s.name}`;
        break;
      }
      case 'woodcut':
        p = sample(16, (i) => BIOMES[w.biome[i]].wood);
        c.goal = 'Gathering wood';
        break;
      case 'mine':
        p = sample(20, (i) => BIOMES[w.biome[i]].stone + (t.techs.includes('bronze') && w.ore[i] > 0 ? 1 : 0));
        c.goal = 'Quarrying stone';
        break;
      case 'build':
        p = { x: s.x + rng.range(-1.5, 1.5), y: s.y + rng.range(-1.5, 1.5) };
        c.goal = `Building in ${s.name}`;
        break;
      case 'guard': {
        const a = rng.next() * Math.PI * 2, r = rng.range(2, 6 + s.tier * 2);
        p = { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r };
        c.goal = `Guarding ${s.name}`;
        break;
      }
      case 'raid': {
        let best: Settlement | undefined, bd = Infinity;
        for (const e of enemies) {
          const et = this.tribeById.get(e);
          if (!et) continue;
          for (const sid of et.settlementIds) {
            const es = this.settlement(sid);
            if (!es) continue;
            const d = dist2d(es.x - c.x, es.y - c.y);
            if (d < bd) { bd = d; best = es; }
          }
        }
        if (best && bd < 120) {
          p = { x: best.x, y: best.y };
          c.targetId = best.id;
          c.goal = `Raiding ${best.name}`;
        }
        break;
      }
      case 'trade': {
        let best: Settlement | undefined, bd = Infinity;
        for (const al of allies) {
          const at = this.tribeById.get(al);
          if (!at) continue;
          for (const sid of at.settlementIds) {
            const as = this.settlement(sid);
            if (!as) continue;
            const d = dist2d(as.x - c.x, as.y - c.y);
            if (d < bd) { bd = d; best = as; }
          }
        }
        if (best && bd < 100) {
          p = { x: best.x, y: best.y };
          c.targetId = best.id;
          c.goal = `Leading a caravan to ${best.name}`;
          c.carryKind = 'food';
          c.carry = 0;
        }
        break;
      }
      case 'scout':
        planExplore(sim, c, `Scouting the lands around ${s.name}`);
        c.action = 'work';
        c.job = 'scout';
        return true;
    }
    if (!p) {
      c.job = 'forage';
      p = { x: s.x + rng.range(-6, 6), y: s.y + rng.range(-6, 6) };
      c.goal = `Foraging for ${s.name}`;
    }
    c.tx = p.x; c.ty = p.y;
    return true;
  }

  actWork(sim: Simulation, c: Creature): void {
    const t = this.tribeById.get(c.tribeId);
    if (!t) { c.decideIn = 0; return; }
    const s = c.homeId >= 0 ? this.settlement(c.homeId) : undefined;
    const w = sim.world;
    const tools = t.techs.includes('tools') ? 1.5 : 1;
    const capacity = 6 * c.size;
    const job = c.job;
    if (!s || job === 'scout' || !job) {
      if (moveToward(sim, c, c.tx, c.ty, 0.9) < 1) c.decideIn = 0;
      return;
    }
    // Returning with goods.
    if (c.carry > 0 && (c.carry >= capacity || c.targetId === -9)) {
      if (moveToward(sim, c, s.x, s.y) < 1.5) {
        const k = c.carryKind ?? 'food';
        const amount = c.carry * (k === 'food' && t.traditions.includes('Harvest Festival') ? 1.1 : 1);
        s.stock[k] += amount;
        if (k === 'food') { if (job === 'trade') s.importAcc += amount; else s.prodAcc += amount; }
        c.carry = 0;
        c.carryKind = null;
        c.targetId = -1;
        c.decideIn = 0;
      }
      return;
    }
    switch (job) {
      case 'forage':
      case 'farm': {
        if (moveToward(sim, c, c.tx, c.ty) < 0.8) {
          const i = w.tileAt(c.x, c.y);
          if (job === 'farm' && w.veg[i] < 3) {
            w.veg[i] += 0.06; // tending
            if (c.actionTicks > 160) c.decideIn = 0;
            return;
          }
          const reserve = 0.4 + Math.max(0, pol(t, 'conservation')) * 1.2;
          const take = Math.min(Math.max(0, w.veg[i] - reserve), 0.5 * c.effSize * tools * (job === 'farm' ? 1.4 : 1));
          if (take < 0.05) {
            if (c.carry > 0) c.targetId = -9; else c.decideIn = 0;
            return;
          }
          w.veg[i] -= take;
          c.carry += take;
          c.carryKind = 'food';
          if (c.carry >= capacity) c.targetId = -9;
        }
        return;
      }
      case 'woodcut':
      case 'mine': {
        if (moveToward(sim, c, c.tx, c.ty) < 0.8) {
          const i = w.tileAt(c.x, c.y);
          const b = BIOMES[w.biome[i]];
          if (job === 'woodcut') {
            if (b.wood < 0.1) { c.decideIn = 0; return; }
            c.carry += 0.05 * tools * b.wood;
            c.carryKind = 'wood';
          } else {
            const ore = t.techs.includes('bronze') && w.ore[i] > 0;
            if (b.stone < 0.1 && !ore) { c.decideIn = 0; return; }
            c.carry += 0.035 * tools * Math.max(b.stone, 0.4);
            c.carryKind = ore && sim.rng.chance(0.5) ? 'ore' : 'stone';
          }
          if (c.carry >= capacity) c.targetId = -9;
        }
        return;
      }
      case 'build': {
        if (moveToward(sim, c, c.tx, c.ty) < 1) {
          if (c.actionTicks % 25 === 0) {
            if (s.stock.wood >= 3) {
              s.stock.wood -= 3;
              s.wood += t.techs.includes('construction') ? 1.5 : 1;
              if (t.techs.includes('masonry') && s.stock.stone >= 2) { s.stock.stone -= 2; s.stone += 1; }
            } else if (s.stock.stone >= 3) {
              s.stock.stone -= 3;
              s.stone += t.techs.includes('masonry') ? 1 : 0.6;
            } else if (s.econ.crowding > 0.7 && localTimber(sim, s) < 0.2) {
              // Sod, mud and thatch: slow to raise and perishable like timber.
              s.wood += t.techs.includes('construction') ? 0.45 : 0.3;
            } else c.decideIn = 0;
          }
          if (c.actionTicks > 150) c.decideIn = 0;
        }
        return;
      }
      case 'guard': {
        if (moveToward(sim, c, c.tx, c.ty, 0.7) < 0.8 && c.actionTicks > 90) c.decideIn = 0;
        return;
      }
      case 'raid': {
        const es = this.settlement(c.targetId);
        if (!es || !this.atWar(t.id, es.tribeId)) { c.decideIn = 0; c.job = null; return; }
        c.sprint = false;
        const d = moveToward(sim, c, es.x, es.y);
        if (d < 6) {
          // Fight defenders first.
          const n = sim.spatial.query(c.x, c.y, 3, qbuf, 20, c);
          for (let k = 0; k < n; k++) {
            const o = qbuf[k];
            if (o.tribeId === es.tribeId) {
              if (c.attackCd === 0) {
                attack(sim, c, o);
                if (!o.alive) { t.kills++; const et = this.tribeById.get(es.tribeId); if (et) et.losses++; }
              }
              return;
            }
          }
          if (d < 2 && c.attackCd === 0) {
            c.attackCd = 10;
            es.health -= c.strength * 2.2 * this.combatBonus(c) / (es.walls && es.wallCondition > 0.3 ? 2 : 1);
            es.threat += 0.02;
            const r = this.rel(t.id, es.tribeId);
            if (r?.causeId !== undefined) es.lastCause = r.causeId;
            if (es.health <= 0) this.sack(sim, es, t, c);
          }
        }
        if (c.actionTicks > 700) c.decideIn = 0;
        return;
      }
      case 'trade': {
        const as = this.settlement(c.targetId);
        if (!as) { c.decideIn = 0; return; }
        if (moveToward(sim, c, as.x, as.y) < 1.5) {
          const r = this.rel(t.id, as.tribeId);
          const other = this.tribeById.get(as.tribeId);
          if (r && other) {
            r.value = Math.min(100, r.value + 4);
            if (!r.traded) {
              r.traded = true;
              settlementEvent(sim, as, { cat: 'civ', level: 2, title: 'Trade route', text: `A caravan from ${t.name} reached ${as.name}. A trade route now links ${t.name} and ${other.name}.`, tribeId: t.id });
            }
            // Trade creates wealth on both sides.
            as.stock.food += 3; as.stock.wood += 1;
            as.importAcc += 3;
            c.carry = 4; c.carryKind = 'food';
            t.culture.openness = Math.min(1, t.culture.openness + 0.002);
          }
          c.targetId = -9;
        }
        return;
      }
    }
  }

  /** A settlement falls to raiders: loot, refugees, and an inspectable ruin left behind. */
  sack(sim: Simulation, s: Settlement, by: Tribe, raider: Creature | null): void {
    const victim = this.tribeById.get(s.tribeId);
    const home = raider && raider.homeId >= 0 ? this.settlement(raider.homeId) : this.settlement(by.capitalId);
    for (const k of ['food', 'wood', 'stone', 'ore'] as const) {
      const loot = s.stock[k] * 0.6;
      s.stock[k] -= loot;
      if (home) home.stock[k] += loot;
    }
    const residents = sim.creatures.filter((c) => c.alive && c.homeId === s.id);
    for (const c of residents) c.remember(sim.tick, 'loss', `Lost home when ${s.name} fell to ${by.name}`);
    const r = victim ? this.rel(by.id, victim.id) : undefined;
    const ev = settlementEvent(sim, s, {
      cat: 'war', level: 3, title: 'Settlement destroyed', text: `${s.name}${victim ? ` of ${victim.name}` : ''} was sacked and burned by ${by.name}.`,
      tribeId: by.id, causeId: r?.causeId,
    });
    s.wood *= 0.4;
    s.wallCondition *= 0.5;
    s.health = 0;
    if (victim) { victim.recentLossTick = sim.tick; this.lastLossEvent.set(victim.id, ev.id); }
    makeRefugees(sim, this, s, residents, ev.id, `the fall of ${s.name}`);
    abandon(sim, this, s, `sacked by ${by.name}`, ev.id, 'war', false);
    sim.fx.push({ kind: 'fire', x: s.x, y: s.y, r: 4, tick: sim.tick });
  }

  /** Damage settlements in radius (disasters). Returns destroyed count. */
  damageArea(sim: Simulation, x: number, y: number, radius: number, amount: number, cause: string, causeId = -1): number {
    let destroyed = 0;
    for (const s of this.settlements) {
      if (s.destroyed) continue;
      const d = dist2d(s.x - x, s.y - y);
      if (d > radius) continue;
      const f = 1 - d / radius;
      s.health -= amount * f / (s.walls ? 1.3 : 1);
      s.wood *= 1 - 0.35 * f;
      s.stone *= 1 - 0.15 * f;
      s.threat += 0.3 * f;
      if (causeId >= 0) s.lastCause = causeId;
      if (s.health <= 0) {
        const t = this.tribeById.get(s.tribeId);
        const residents = sim.creatures.filter((c) => c.alive && c.homeId === s.id);
        const ev = settlementEvent(sim, s, { cat: 'disaster', level: 3, title: 'Settlement lost', text: `${s.name}${t ? ` of ${t.name}` : ''} was destroyed by ${cause}.`, tribeId: s.tribeId, causeId: causeId >= 0 ? causeId : undefined });
        if (t) { t.recentLossTick = sim.tick; this.lastLossEvent.set(t.id, ev.id); }
        makeRefugees(sim, this, s, residents, ev.id, cause);
        abandon(sim, this, s, `destroyed by ${cause}`, ev.id, 'disaster', false);
        destroyed++;
      }
    }
    return destroyed;
  }

  // ---------------------------------------------------------------- Views

  tribeView(sim: Simulation, t: Tribe): TribeView {
    const rels: TribeView['relations'] = [];
    for (const r of this.relations.values()) {
      if (r.a !== t.id && r.b !== t.id) continue;
      const other = r.a === t.id ? r.b : r.a;
      const ot = this.tribeById.get(other);
      if (!ot || ot.collapsed) continue;
      rels.push({ tribeId: other, value: Math.round(r.value), status: r.status });
    }
    const def = t.current ? TECH_BY_ID.get(t.current) : undefined;
    const st = this.stockOf(t);
    let inTransit = 0;
    for (const g of this.groups) if (g.tribeId === t.id) inTransit += g.members.length;
    return {
      id: t.id, name: t.name, speciesId: t.speciesId, color: `hsl(${Math.round(t.hue * 360)}, 70%, 60%)`, hue: t.hue,
      founded: t.founded, population: t.population, peak: t.peak, settlements: t.settlementIds.length, territory: t.territory,
      techs: t.techs.slice(), researching: t.current, researchProgress: def ? Math.min(1, t.research / def.cost) : 0,
      stock: { food: Math.round(st.food), wood: Math.round(st.wood), stone: Math.round(st.stone), ore: Math.round(st.ore) },
      culture: { ...t.culture }, archetype: t.archetype, government: t.government, traditions: t.traditions.slice(),
      leaderId: t.leaderId, leaderName: t.leaderName, collapsed: t.collapsed, collapsedTick: t.collapsedTick,
      relations: rels, homeX: t.homeX, homeY: t.homeY, history: t.history.slice(),
      capitalId: t.capitalId, capitalName: this.settlementById.get(t.capitalId)?.name ?? '—',
      stability: t.stability, instability: t.instability, goals: t.goals.slice(), policies: { ...t.policies },
      pendingPolicies: t.pendingPolicies.map((p) => ({ ...p })), policyHistory: t.policyHistory.slice(-8),
      foodSecurity: t.foodSecurity, military: t.military, migIn: t.migIn, migOut: t.migOut, inTransit,
      parentTribeId: t.parentTribeId, successors: t.successors.slice(), economy: t.economy,
      settlementIds: t.settlementIds.slice(), recentEvents: t.events.slice(-12),
    };
  }

  settlementView(s: Settlement): SettlementView {
    return settlementView(this, s);
  }

  settlementDetail(sim: Simulation, id: number): SettlementDetail | null {
    const s = this.settlementById.get(id);
    if (!s) return null;
    const t = this.tribeById.get(s.tribeId);
    const hist = s.popHistory;
    const prev = hist.length > 1 ? hist[Math.max(0, hist.length - 2)] : s.population;
    const parent = s.parentId >= 0 ? this.settlementById.get(s.parentId) : undefined;
    const evs: SimEvent[] = [];
    const byId = new Map(sim.events.events.map((e) => [e.id, e]));
    for (const eid of s.events.slice().reverse()) { const e = byId.get(eid); if (e) evs.push(e); }
    const groups = this.groups.filter((g) => g.originId === s.id || g.destId === s.id).map((g) => groupView(sim, this, g));
    return {
      id: s.id, name: s.name, tribeId: s.tribeId, tribeName: t?.name ?? '—', tribeHue: t?.hue ?? 0, state: s.state, stateSince: s.stateSince,
      tier: s.tier, tierName: TIER_NAMES[s.tier], x: s.x, y: s.y, population: s.population, populationChange: s.population - prev,
      housing: Math.round(housingOf(s)), peak: s.peak, founded: s.founded, abandonedTick: s.destroyed ? s.destroyedTick : null,
      foodProd: s.econ.foodProd, foodCons: s.econ.foodCons, imports: s.econ.imports, reserveDays: s.econ.reserveDays, nourishment: s.econ.nourishment,
      stock: { food: Math.round(s.stock.food), wood: Math.round(s.stock.wood), stone: Math.round(s.stock.stone), ore: Math.round(s.stock.ore) },
      jobs: s.econ.jobs, employment: s.econ.employment, water: s.econ.water, security: s.econ.security, disease: s.econ.disease,
      crowding: s.econ.crowding, prosperity: s.econ.prosperity, pressure: s.econ.pressure, mainProblem: s.econ.mainProblem,
      economy: s.destroyed ? STATE_LABEL[s.state] : s.econ.prosperity > 0.35 ? 'Prosperous' : s.econ.prosperity > 0.05 ? 'Comfortable' : s.econ.prosperity > -0.25 ? 'Strained' : 'Failing',
      migIn: s.migIn, migOut: s.migOut, reserved: s.reserved, groups,
      structures: { wood: Math.round(s.wood * 10) / 10, stone: Math.round(s.stone * 10) / 10, walls: s.walls, wallCondition: s.wallCondition, farms: s.destroyed ? s.oldFarms.length : s.farms.length, farmCondition: s.destroyed ? s.farmCondition : 1, health: s.health },
      isCapital: !!t && t.capitalId === s.id && !s.destroyed, parentName: parent?.name ?? null,
      eras: s.eras.map((e) => ({ ...e })), popHistory: hist.slice(-160), events: evs.slice(0, 16),
    };
  }

  serialize() {
    return {
      tribes: this.tribes.map((t) => JSON.parse(JSON.stringify(t))),
      settlements: this.settlements.map((s) => JSON.parse(JSON.stringify(s))),
      relations: [...this.relations.values()].map((r) => ({ ...r })),
      groups: this.groups.map((g) => JSON.parse(JSON.stringify(g))),
      nextTribeId: this.nextTribeId,
      nextSettlementId: this.nextSettlementId,
      nextGroupId: this.nextGroupId,
      pass: this.pass,
      firstTech: [...this.firstTech],
      firstTier: [...this.firstTier],
      counters: { ...this.counters },
      lastLossEvent: [...this.lastLossEvent.entries()],
      borderReported: [...this.borderReported.entries()],
      territoryDirty: this.territoryDirty,
    };
  }

  static deserialize(d: ReturnType<CivManager['serialize']>): CivManager {
    const m = new CivManager();
    m.tribes = d.tribes;
    m.settlements = d.settlements;
    m.groups = d.groups ?? [];
    for (const t of m.tribes) m.tribeById.set(t.id, t);
    for (const s of m.settlements) m.settlementById.set(s.id, s);
    for (const g of m.groups) m.groupById.set(g.id, g);
    for (const r of d.relations) m.relations.set(m.key(r.a, r.b), r as DiploRel);
    m.nextTribeId = d.nextTribeId;
    m.nextSettlementId = d.nextSettlementId;
    m.nextGroupId = d.nextGroupId ?? 1;
    m.pass = d.pass;
    m.firstTech = new Set(d.firstTech);
    m.firstTier = new Set(d.firstTier);
    m.counters = { ...emptyCounters(), ...(d.counters ?? {}) };
    m.lastLossEvent = new Map(d.lastLossEvent ?? []);
    m.borderReported = new Map(d.borderReported ?? []);
    // Territory is saved with the world, so only recompute it if the save says it was stale (older saves: recompute).
    m.territoryDirty = d.territoryDirty ?? true;
    return m;
  }
}

/** Mean timber availability around a settlement (fixed sample pattern, no randomness). */
function localTimber(sim: Simulation, s: Settlement): number {
  const w = sim.world;
  let sum = 0, n = 0;
  for (let dy = -12; dy <= 12; dy += 6) {
    for (let dx = -12; dx <= 12; dx += 6) {
      if (!w.inBounds(s.x + dx, s.y + dy)) continue;
      sum += BIOMES[w.biome[w.tileAt(s.x + dx, s.y + dy)]].wood;
      n++;
    }
  }
  return n ? sum / n : 0;
}

export function archetypeOf(c: Culture): string {
  const entries: [string, number][] = [
    ['Warlike', c.militarism],
    [c.militarism < 0.3 ? 'Peaceful' : 'Mercantile', c.openness],
    ['Scholarly', c.scholarship],
    ['Agrarian', c.agrarian],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function isCoastal(sim: Simulation, x: number, y: number): boolean {
  const w = sim.world;
  for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
    if (!w.inBounds(x + dx, y + dy)) continue;
    const b = w.biome[w.tileAt(x + dx, y + dy)];
    if (b === 1 || b === 2) return true;
  }
  return false;
}

function aOrAn(s: string): string {
  return /^[AEIOU]/.test(s) ? `an ${s}` : `a ${s}`;
}

export const TIER_LABELS = TIER_NAMES;
export { CIV_INTERVAL, genomeToRecord, GOAL_LABEL, CAPACITY, PASSES_PER_DAY, currentEra };
