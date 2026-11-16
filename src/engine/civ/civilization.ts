import type { Simulation } from '../simulation';
import type { Creature } from '../creatures/creature';
import { moveToward, planExplore, attack } from '../creatures/behavior';
import { BIOMES } from '../world/biomes';
import { TECH_BY_ID, availableTechs } from './tech';
import { settlementName, tribeName } from '../creatures/names';
import {
  CIV_INTERVAL, PLANT_ENERGY, TRIBE_MIN_FOUNDERS, TRIBE_MIN_INT, TRIBE_MIN_SOCIAL, TICKS_PER_DAY,
} from '../constants';
import type { Job, SettlementView, TribeView } from '../types';
import { genomeToRecord } from '../creatures/genome';
import { dist2d } from '../mathutil';

export interface Stock { food: number; wood: number; stone: number; ore: number }
export interface Culture { militarism: number; openness: number; scholarship: number; agrarian: number }

export interface Tribe {
  id: number;
  name: string;
  speciesId: number;
  hue: number;
  founded: number;
  leaderId: number;
  leaderName: string;
  population: number;
  peak: number;
  settlementIds: number[];
  stock: Stock;
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
  population: number;
  buildings: number;
  walls: boolean;
  farms: number[];
  destroyed: boolean;
  destroyedTick: number;
}

interface DiploRel {
  a: number;
  b: number;
  value: number;
  status: 'peace' | 'alliance' | 'war';
  since: number;
  traded: boolean;
}

const TIER_NAMES = ['Camp', 'Village', 'Town', 'City'];
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

export class CivManager {
  tribes: Tribe[] = [];
  settlements: Settlement[] = [];
  tribeById = new Map<number, Tribe>();
  settlementById = new Map<number, Settlement>();
  relations = new Map<string, DiploRel>();
  nextTribeId = 1;
  nextSettlementId = 1;
  pass = 0;
  firstTech = new Set<string>();
  firstTier = new Set<number>();
  territoryDirty = true;

  tribe(id: number): Tribe | undefined { return this.tribeById.get(id); }
  settlement(id: number): Settlement | undefined {
    const s = this.settlementById.get(id);
    return s && !s.destroyed ? s : undefined;
  }

  activeTribes(): Tribe[] { return this.tribes.filter((t) => !t.collapsed); }
  activeSettlements(): Settlement[] { return this.settlements.filter((s) => !s.destroyed); }

  hasTech(tribeId: number, tech: string): boolean {
    const t = this.tribeById.get(tribeId);
    return !!t && t.techs.includes(tech);
  }

  private key(a: number, b: number): string { return a < b ? `${a}:${b}` : `${b}:${a}`; }
  rel(a: number, b: number): DiploRel | undefined { return this.relations.get(this.key(a, b)); }

  atWar(a: number, b: number): boolean { return this.rel(a, b)?.status === 'war'; }

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

  combatBonus(c: Creature): number {
    if (c.tribeId < 0) return 1;
    const t = this.tribeById.get(c.tribeId);
    if (!t) return 1;
    let b = 1;
    if (t.techs.includes('hunting')) b += 0.35;
    if (t.techs.includes('bronze')) b += 0.5;
    if (t.traditions.includes('Warrior Trials')) b += 0.1;
    return b;
  }

  defenseBonus(c: Creature): number {
    if (c.tribeId < 0) return 1;
    let b = this.hasTech(c.tribeId, 'bronze') ? 1.2 : 1;
    if (c.homeId >= 0) {
      const s = this.settlement(c.homeId);
      if (s && s.walls && Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < 6) b *= 1.6;
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

  eatFromStore(c: Creature): void {
    const t = this.tribeById.get(c.tribeId);
    if (!t) return;
    const need = (c.maxEnergy * 0.95 - c.energy) / (PLANT_ENERGY * 0.9);
    const take = Math.max(0, Math.min(t.stock.food, need));
    t.stock.food -= take;
    c.energy += take * PLANT_ENERGY * 0.9;
  }

  // ---------------------------------------------------------------- Update

  update(sim: Simulation): void {
    this.pass++;
    this.refreshMembership(sim);
    this.formTribes(sim);
    for (const t of this.tribes) {
      if (t.collapsed) continue;
      this.research(sim, t);
      this.manageSettlements(sim, t);
      if (this.pass % 10 === 0) {
        t.history.push(t.population);
        if (t.history.length > 160) t.history.shift();
      }
    }
    if (this.pass % 5 === 0) this.diplomacy(sim);
    if (this.pass % 4 === 0 || this.territoryDirty) this.computeTerritory(sim);
  }

  private refreshMembership(sim: Simulation): void {
    const members = new Map<number, Creature[]>();
    for (const s of this.settlements) s.population = 0;
    for (const c of sim.creatures) {
      if (!c.alive || c.tribeId < 0) continue;
      const t = this.tribeById.get(c.tribeId);
      if (!t || t.collapsed) { c.tribeId = -1; c.homeId = -1; c.job = null; continue; }
      let m = members.get(c.tribeId);
      if (!m) { m = []; members.set(c.tribeId, m); }
      m.push(c);
      if (c.homeId >= 0) {
        const s = this.settlement(c.homeId);
        if (!s || s.tribeId !== c.tribeId) c.homeId = -1;
      }
      if (c.homeId < 0 && t.settlementIds.length > 0) {
        let best: Settlement | undefined, bd = Infinity;
        for (const sid of t.settlementIds) {
          const s = this.settlement(sid);
          if (!s) continue;
          const d = Math.abs(s.x - c.x) + Math.abs(s.y - c.y);
          if (d < bd) { bd = d; best = s; }
        }
        if (best) c.homeId = best.id;
      }
      if (c.homeId >= 0) this.settlementById.get(c.homeId)!.population++;
    }
    for (const t of this.tribes) {
      if (t.collapsed) continue;
      const m = members.get(t.id) ?? [];
      t.population = m.length;
      if (t.population > t.peak) t.peak = t.population;
      t.settlementIds = t.settlementIds.filter((id) => this.settlement(id));
      const leader = sim.byId.get(t.leaderId);
      if (m.length === 0) {
        this.collapse(sim, t, 'its last member perished');
        continue;
      }
      if (m.length < 2 || (m.length < 3 && t.settlementIds.length === 0 && sim.tick - t.founded > TICKS_PER_DAY * 10)) {
        for (const c of m) { c.tribeId = -1; c.homeId = -1; c.job = null; }
        this.collapse(sim, t, 'its few survivors scattered');
        continue;
      }
      if (!leader || !leader.alive || leader.tribeId !== t.id) {
        let best = m[0], bs = -Infinity;
        for (const c of m) {
          const s = c.intelligence * 2 + c.age / c.lifespan + c.strength * 0.3 + (c.mature ? 1 : -5);
          if (s > bs) { bs = s; best = c; }
        }
        const old = t.leaderName;
        t.leaderId = best.id;
        t.leaderName = best.name;
        best.title = 'Leader';
        best.remember(sim.tick, 'leader', `Became leader of ${t.name}`);
        if (t.population >= 5) {
          sim.events.push({ tick: sim.tick, cat: 'civ', level: 1, title: 'New leader', text: `${best.name} succeeds ${old} as leader of ${t.name}.`, x: best.x, y: best.y, tribeId: t.id, creatureId: best.id });
        }
      }
      const leaderC = sim.byId.get(t.leaderId);
      if (leaderC) {
        if (t.settlementIds.length === 0) { t.homeX = leaderC.x; t.homeY = leaderC.y; }
      }
      if (t.settlementIds.length > 0) {
        const cap = this.settlement(t.settlementIds[0]);
        if (cap) { t.homeX = cap.x; t.homeY = cap.y; }
      }
    }
  }

  private collapse(sim: Simulation, t: Tribe, reason: string): void {
    t.collapsed = true;
    t.collapsedTick = sim.tick;
    t.population = 0;
    for (const sid of t.settlementIds) {
      const s = this.settlementById.get(sid);
      if (s && !s.destroyed) this.ruin(sim, s);
    }
    for (const r of this.relations.values()) if (r.a === t.id || r.b === t.id) r.status = 'peace';
    const big = t.peak >= 10 || t.settlementIds.length > 0;
    sim.events.push({
      tick: sim.tick, cat: 'civ', level: big ? 3 : 1,
      title: big ? 'Civilization collapsed' : 'Band dispersed',
      text: big ? `${t.name} has collapsed — ${reason}. At its height it numbered ${t.peak}.` : `${t.name} is no more: ${reason}.`,
      x: t.homeX, y: t.homeY, tribeId: t.id,
    });
    this.territoryDirty = true;
  }

  private ruin(sim: Simulation, s: Settlement): void {
    s.destroyed = true;
    s.destroyedTick = sim.tick;
    for (const f of s.farms) sim.world.farm[f] = 0;
    s.farms = [];
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

  createTribe(sim: Simulation, founders: Creature[]): Tribe {
    const rng = sim.rng;
    const sp = sim.species.get(founders[0].speciesId);
    const lang = sp?.lang ?? [0, 1, 2, 3, 4, 5];
    const avg = (f: (c: Creature) => number) => founders.reduce((s, c) => s + f(c), 0) / founders.length;
    const leader = founders.reduce((a, b) => (b.intelligence > a.intelligence ? b : a));
    const tile = sim.world.tileAt(leader.x, leader.y);
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const culture: Culture = {
      militarism: clamp(avg((c) => c.aggression) * 1.2 - 0.05 + rng.gauss(0, 0.12)),
      openness: clamp(avg((c) => c.sociability) * 0.7 + (1 - avg((c) => c.aggression)) * 0.3 + rng.gauss(0, 0.12) - 0.05),
      scholarship: clamp(avg((c) => c.intelligence) * 0.8 + avg((c) => c.curiosity) * 0.4 - 0.3 + rng.gauss(0, 0.12)),
      agrarian: clamp(sim.world.fertility[tile] * 0.6 + rng.gauss(0.2, 0.15)),
    };
    const t: Tribe = {
      id: this.nextTribeId++,
      name: tribeName(rng, lang),
      speciesId: founders[0].speciesId,
      hue: ((this.nextTribeId * 0.618034) % 1),
      founded: sim.tick,
      leaderId: leader.id,
      leaderName: leader.name,
      population: founders.length,
      peak: founders.length,
      settlementIds: [],
      stock: { food: 0, wood: 0, stone: 0, ore: 0 },
      research: 0,
      techs: [],
      current: null,
      culture,
      archetype: archetypeOf(culture),
      government: 'Nomadic Band',
      traditions: [],
      collapsed: false,
      collapsedTick: null,
      homeX: leader.x,
      homeY: leader.y,
      nomadicSince: sim.tick,
      waterSpots: [],
      lang,
      territory: 0,
      history: [],
      kills: 0,
      losses: 0,
    };
    this.addTradition(sim, t);
    this.tribes.push(t);
    this.tribeById.set(t.id, t);
    for (const c of founders) {
      c.tribeId = t.id;
      c.remember(sim.tick, 'tribe', c === leader ? `Founded ${t.name}` : `Joined ${t.name}, led by ${leader.name}`);
      if (c.waterX >= 0) t.waterSpots.push({ x: c.waterX, y: c.waterY });
    }
    leader.title = 'Founder';
    sim.events.push({
      tick: sim.tick, cat: 'civ', level: this.tribes.length === 1 ? 3 : 2,
      title: this.tribes.length === 1 ? 'The first tribe' : 'A tribe has formed',
      text: `${founders.length} ${sp?.common ?? 'creatures'} gathered around ${leader.name} and became ${t.name} — a ${t.archetype.toLowerCase()} people who practice ${t.traditions[0]}.`,
      x: leader.x, y: leader.y, tribeId: t.id, creatureId: leader.id, speciesId: t.speciesId,
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
    t.research += pts;
    const def = TECH_BY_ID.get(t.current!)!;
    if (t.research >= def.cost) {
      t.research -= def.cost;
      t.techs.push(def.id);
      t.current = null;
      const first = !this.firstTech.has(def.id);
      this.firstTech.add(def.id);
      sim.events.push({
        tick: sim.tick, cat: 'civ', level: first ? 2 : 1,
        title: first ? `Discovery: ${def.name}` : `${def.name} learned`,
        text: first ? `${t.name} discovered ${def.name} — the first in the world. ${def.description}` : `${t.name} have learned ${def.name}.`,
        x: t.homeX, y: t.homeY, tribeId: t.id,
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
        sim.events.push({ tick: sim.tick, cat: 'civ', level: 2, title: 'New government', text: `${t.name} transformed from ${aOrAn(old)} into ${aOrAn(g)}.`, x: t.homeX, y: t.homeY, tribeId: t.id });
      } else {
        t.government = g;
      }
    }
  }

  private siteScore(sim: Simulation, x: number, y: number, tribeId: number): number {
    const w = sim.world;
    if (!w.inBounds(x, y)) return -10;
    const i = w.tileAt(x, y);
    if (!w.isLand(i) || w.biome[i] === 16 || w.biome[i] === 14) return -10;
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

  private foundSettlement(sim: Simulation, t: Tribe, x: number, y: number, colonists: Creature[], from?: Settlement): Settlement {
    const s: Settlement = {
      id: this.nextSettlementId++,
      tribeId: t.id,
      name: settlementName(sim.rng, t.lang),
      x, y,
      tier: 0,
      founded: sim.tick,
      health: 100,
      population: colonists.length,
      buildings: 2,
      walls: false,
      farms: [],
      destroyed: false,
      destroyedTick: 0,
    };
    this.settlements.push(s);
    this.settlementById.set(s.id, s);
    t.settlementIds.push(s.id);
    for (const c of colonists) {
      c.homeId = s.id;
      c.remember(sim.tick, 'settle', from ? `Left ${from.name} to found ${s.name}` : `Helped found ${s.name}`);
    }
    const w = sim.world;
    const i = w.tileAt(x, y);
    const by = w.river[i] > 0 || w.waterDist[i] <= 2 ? (w.lake[i] || w.biome[i] === 3 ? 'on a lakeshore' : 'by the river') : isCoastal(sim, x, y) ? 'on the coast' : `in the ${BIOMES[w.biome[i]].name.toLowerCase()}`;
    const firstEver = this.settlements.length === 1;
    sim.events.push({
      tick: sim.tick, cat: 'civ', level: firstEver ? 3 : from ? 1 : 2,
      title: firstEver ? 'The first settlement' : from ? 'New colony' : 'Settlement established',
      text: from ? `Settlers from ${from.name} founded ${s.name} ${by}.` : `${t.name} settled down and founded ${s.name} ${by}.${firstEver ? ' History has begun.' : ''}`,
      x, y, tribeId: t.id, settlementId: s.id,
    });
    if (t.government === 'Nomadic Band') t.government = 'Chiefdom';
    this.territoryDirty = true;
    return s;
  }

  private manageSettlements(sim: Simulation, t: Tribe): void {
    const rng = sim.rng;
    const w = sim.world;
    // Nomadic bands look for a home.
    if (t.settlementIds.length === 0) {
      if (t.population < 4) return;
      const leader = sim.byId.get(t.leaderId);
      if (!leader) return;
      let bx = leader.x, by = leader.y, bs = this.siteScore(sim, leader.x, leader.y, t.id);
      for (let k = 0; k < 6; k++) {
        const x = leader.x + rng.range(-8, 8), y = leader.y + rng.range(-8, 8);
        const s = this.siteScore(sim, x, y, t.id);
        if (s > bs) { bs = s; bx = x; by = y; }
      }
      const waited = sim.tick - t.nomadicSince;
      if (bs > 1.25 || (waited > TICKS_PER_DAY * 3 && bs > 0.7) || (waited > TICKS_PER_DAY * 8 && bs > 0.2)) {
        const members = sim.creatures.filter((c) => c.tribeId === t.id && c.alive);
        this.foundSettlement(sim, t, bx, by, members);
      }
      return;
    }

    // Spoilage and storage caps.
    const pottery = t.techs.includes('pottery');
    t.stock.food *= pottery ? 0.9985 : 0.996;
    const cap = (40 + t.population * 14) * (pottery ? 2 : 1);
    if (t.stock.food > cap) t.stock.food = cap;
    for (const k of ['wood', 'stone', 'ore'] as const) if (t.stock[k] > 400) t.stock[k] = 400;

    for (const sid of t.settlementIds.slice()) {
      const s = this.settlement(sid);
      if (!s) continue;
      if (s.health < 100) s.health = Math.min(100, s.health + 0.2);

      // Tier upgrades.
      const has = (x: string) => t.techs.includes(x);
      let up = false;
      if (s.tier === 0 && (has('construction') || has('agriculture')) && s.population >= 9 && s.buildings >= 10) up = true;
      else if (s.tier === 1 && has('masonry') && s.population >= 20 && s.buildings >= 35) up = true;
      else if (s.tier === 2 && has('engineering') && s.population >= 35 && s.buildings >= 80) up = true;
      if (up) {
        s.tier++;
        const first = !this.firstTier.has(s.tier);
        this.firstTier.add(s.tier);
        sim.events.push({
          tick: sim.tick, cat: 'civ', level: s.tier === 3 || first ? 3 : 2,
          title: first ? `The first ${TIER_NAMES[s.tier].toLowerCase()}` : `${s.name} grows`,
          text: `${s.name} of ${t.name} has grown into a ${TIER_NAMES[s.tier].toLowerCase()} of ${s.population}.${first ? ' Nothing like it has existed before.' : ''}`,
          x: s.x, y: s.y, tribeId: t.id, settlementId: s.id,
        });
        if (t.traditions.length < 4) this.addTradition(sim, t);
        this.territoryDirty = true;
      }
      if (!s.walls && has('masonry') && s.tier >= 1 && t.stock.stone >= 40) {
        t.stock.stone -= 40;
        s.walls = true;
        sim.events.push({ tick: sim.tick, cat: 'civ', level: 1, title: 'Walls raised', text: `${s.name} raised stone walls.`, x: s.x, y: s.y, tribeId: t.id, settlementId: s.id });
      }

      // Farms.
      if (has('agriculture')) {
        const want = 4 + s.tier * 6 + (pottery ? 2 : 0);
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

      // Expansion: overcrowded settlements send out colonists.
      if (s.population > CAPACITY[s.tier] * 0.85 && t.population >= 22 && t.settlementIds.length < Math.min(1 + Math.floor(t.population / 28), 2 + Math.floor(t.techs.length / 3)) && rng.chance(0.15)) {
        let bx = 0, by = 0, bs = 0.6;
        for (let k = 0; k < 14; k++) {
          const a = rng.next() * Math.PI * 2, r = rng.range(12, 26);
          const x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
          const sc = this.siteScore(sim, x, y, t.id);
          if (sc > bs) { bs = sc; bx = x; by = y; }
        }
        if (bs > 0.6) {
          const residents = sim.creatures.filter((c) => c.homeId === s.id && c.alive);
          const colonists = residents.filter((_, i) => i % 3 === 0);
          if (colonists.length >= 6) this.foundSettlement(sim, t, bx, by, colonists, s);
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
        const scarcity = (sc(a) + sc(b)) / 2;
        let target = (a.culture.openness + b.culture.openness) * 25 - (a.culture.militarism + b.culture.militarism) * 30 +
          (same ? 10 : -12) - pressure * scarcity * 45 + (r.traded ? 15 : 0);
        if (r.status === 'war') target += Math.min(40, (sim.tick - r.since) / (TICKS_PER_DAY * 2)); // war weariness
        const shared = this.enemiesOf(a.id).filter((e) => this.enemiesOf(b.id).includes(e)).length;
        target += shared * 25;
        r.value += (target - r.value) * 0.12 + sim.rng.gauss(0, 3);
        r.value = Math.max(-100, Math.min(100, r.value));

        const mil = Math.max(a.culture.militarism, b.culture.militarism);
        if (r.status !== 'war' && r.value < -40 && mil > 0.45) {
          r.status = 'war'; r.since = sim.tick;
          const agg = a.culture.militarism >= b.culture.militarism ? a : b;
          const def = agg === a ? b : a;
          agg.culture.militarism = Math.min(1, agg.culture.militarism + 0.05);
          sim.events.push({ tick: sim.tick, cat: 'war', level: 3, title: 'War declared', text: `${agg.name} declared war on ${def.name}${pressure > 0.3 ? ' over contested land' : ''}.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: agg.id });
        } else if (r.status === 'war' && r.value > -12) {
          r.status = 'peace'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'war', level: 2, title: 'Peace treaty', text: `${a.name} and ${b.name} have made peace.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: a.id });
        } else if (r.status === 'peace' && r.value > 45 && Math.min(a.culture.openness, b.culture.openness) > 0.35) {
          r.status = 'alliance'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'civ', level: 2, title: 'Alliance formed', text: `${a.name} and ${b.name} have formed an alliance.`, x: (a.homeX + b.homeX) / 2, y: (a.homeY + b.homeY) / 2, tribeId: a.id });
        } else if (r.status === 'alliance' && r.value < 10) {
          r.status = 'peace'; r.since = sim.tick;
          sim.events.push({ tick: sim.tick, cat: 'civ', level: 1, title: 'Alliance dissolved', text: `The alliance between ${a.name} and ${b.name} has dissolved.`, x: a.homeX, y: a.homeY, tribeId: a.id });
        }
      }
    }
    function sc(t: Tribe): number {
      return t.population > 0 ? Math.max(0, 1 - t.stock.food / (t.population * 8)) : 0;
    }
  }

  computeTerritory(sim: Simulation): void {
    this.territoryDirty = false;
    const w = sim.world;
    const terr = w.territory;
    terr.fill(-1);
    const inf = new Float32Array(w.size);
    for (const t of this.tribes) t.territory = 0;
    for (const s of this.settlements) {
      if (s.destroyed) continue;
      const t = this.tribeById.get(s.tribeId);
      if (!t || t.collapsed) continue;
      const R = 5 + s.tier * 4 + Math.min(6, t.techs.length * 0.4) + Math.min(4, s.population / 10);
      const x0 = Math.max(0, Math.floor(s.x - R)), x1 = Math.min(w.width - 1, Math.ceil(s.x + R));
      const y0 = Math.max(0, Math.floor(s.y - R)), y1 = Math.min(w.height - 1, Math.ceil(s.y + R));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w.width + x;
          if (!w.isLand(i)) continue;
          const d = dist2d(x + 0.5 - s.x, y + 0.5 - s.y);
          if (d > R) continue;
          const v = (s.tier + 1) * (1 - d / R) + 0.01;
          if (v > inf[i]) { inf[i] = v; terr[i] = t.id; }
        }
      }
    }
    for (let i = 0; i < w.size; i++) if (terr[i] >= 0) { const t = this.tribeById.get(terr[i]); if (t) t.territory++; }
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
    // Keep doing the current job for a while.
    if (c.job && c.actionTicks < 500 && c.action === 'work' && c.carry > 0) return true;

    const has = (x: string) => t.techs.includes(x);
    const needFood = Math.max(0, Math.min(1, 1 - t.stock.food / Math.max(1, t.population * 12)));
    const enemies = this.enemiesOf(t.id);
    const allies = this.alliesOf(t.id);
    const canBuild = t.stock.wood >= 3;
    const weights: [Job, number][] = [
      ['forage', 1 + needFood * 3],
      ['hunt', c.strength > 0.5 ? 0.25 + needFood * 1.2 + t.culture.militarism * 0.4 + (has('hunting') ? 0.8 : 0) : 0],
      ['farm', has('agriculture') && s.farms.length > 0 ? 1.4 + needFood * 2 + t.culture.agrarian : 0],
      ['woodcut', 0.5 + (t.stock.wood < 30 ? 1 : 0.15)],
      ['mine', has('construction') || has('masonry') ? 0.4 + (t.stock.stone < 40 ? 0.7 : 0.1) + (has('bronze') ? 0.3 : 0) : 0],
      ['build', canBuild ? 0.8 + (s.buildings < [12, 40, 90, 200][s.tier] ? 1 : 0.2) : 0],
      ['guard', 0.15 + t.culture.militarism * 0.5 + (enemies.length ? 1.2 : 0)],
      ['raid', enemies.length && c.strength > 0.6 && c.health > c.maxHealth * 0.6 ? 0.6 + t.culture.militarism * 2.5 : 0],
      ['trade', has('trade') && allies.length ? 0.3 + t.culture.openness * 1.2 : 0],
      ['scout', 0.1 + c.curiosity * 0.3],
    ];
    let total = 0;
    for (const [, wv] of weights) total += wv;
    let r = rng.next() * total;
    let job: Job = 'forage';
    for (const [j, wv] of weights) { r -= wv; if (r <= 0) { job = j; break; } }
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
    switch (job) {
      case 'forage':
        p = sample(12, (i) => (w.veg[i] > 2 ? w.veg[i] : 0));
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
        p = sample(14, (i) => (w.veg[i] > 2 ? w.veg[i] : 0));
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
        t.stock[k] += c.carry * (k === 'food' && t.traditions.includes('Harvest Festival') ? 1.1 : 1);
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
          const take = Math.min(Math.max(0, w.veg[i] - 0.4), 0.5 * c.effSize * tools * (job === 'farm' ? 1.4 : 1));
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
            if (t.stock.wood >= 3) {
              t.stock.wood -= 3;
              let gain = t.techs.includes('construction') ? 1.5 : 1;
              if (t.techs.includes('masonry') && t.stock.stone >= 2) { t.stock.stone -= 2; gain += 1; }
              s.buildings += gain;
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
            es.health -= c.strength * 2.2 * this.combatBonus(c) / (es.walls ? 2 : 1);
            if (es.health <= 0) this.sack(sim, es, t);
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
              sim.events.push({ tick: sim.tick, cat: 'civ', level: 2, title: 'Trade route', text: `A caravan from ${t.name} reached ${as.name}. A trade route now links ${t.name} and ${other.name}.`, x: as.x, y: as.y, tribeId: t.id, settlementId: as.id });
            }
            // Trade creates wealth on both sides.
            other.stock.food += 3; other.stock.wood += 1;
            c.carry = 4; c.carryKind = 'food';
            t.culture.openness = Math.min(1, t.culture.openness + 0.002);
          }
          c.targetId = -9;
        }
        return;
      }
    }
  }

  private sack(sim: Simulation, s: Settlement, by: Tribe): void {
    const victim = this.tribeById.get(s.tribeId);
    this.ruin(sim, s);
    if (victim) {
      const share = 1 / Math.max(1, victim.settlementIds.length);
      for (const k of ['food', 'wood', 'stone', 'ore'] as const) {
        const loot = victim.stock[k] * share * 0.6;
        victim.stock[k] -= loot;
        by.stock[k] += loot;
      }
      victim.settlementIds = victim.settlementIds.filter((id) => id !== s.id);
      if (victim.settlementIds.length === 0) victim.nomadicSince = sim.tick;
      for (const c of sim.creatures) if (c.homeId === s.id) {
        c.homeId = -1;
        c.remember(sim.tick, 'loss', `Lost home when ${s.name} fell to ${by.name}`);
      }
    }
    sim.events.push({ tick: sim.tick, cat: 'war', level: 3, title: 'Settlement destroyed', text: `${s.name}${victim ? ` of ${victim.name}` : ''} was sacked and burned by ${by.name}.`, x: s.x, y: s.y, tribeId: by.id, settlementId: s.id });
    sim.fx.push({ kind: 'fire', x: s.x, y: s.y, r: 4, tick: sim.tick });
  }

  /** Damage settlements in radius (disasters). Returns destroyed count. */
  damageArea(sim: Simulation, x: number, y: number, radius: number, amount: number, cause: string): number {
    let destroyed = 0;
    for (const s of this.settlements) {
      if (s.destroyed) continue;
      const d = dist2d(s.x - x, s.y - y);
      if (d > radius) continue;
      s.health -= amount * (1 - d / radius) / (s.walls ? 1.3 : 1);
      s.buildings = Math.max(0, s.buildings * (1 - 0.3 * (1 - d / radius)));
      if (s.health <= 0) {
        const t = this.tribeById.get(s.tribeId);
        this.ruin(sim, s);
        if (t) {
          t.settlementIds = t.settlementIds.filter((id) => id !== s.id);
          if (t.settlementIds.length === 0) t.nomadicSince = sim.tick;
        }
        destroyed++;
        sim.events.push({ tick: sim.tick, cat: 'disaster', level: 3, title: 'Settlement lost', text: `${s.name}${t ? ` of ${t.name}` : ''} was destroyed by ${cause}.`, x: s.x, y: s.y, tribeId: s.tribeId, settlementId: s.id });
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
    return {
      id: t.id, name: t.name, speciesId: t.speciesId, color: `hsl(${Math.round(t.hue * 360)}, 70%, 60%)`, hue: t.hue,
      founded: t.founded, population: t.population, peak: t.peak, settlements: t.settlementIds.length, territory: t.territory,
      techs: t.techs.slice(), researching: t.current, researchProgress: def ? Math.min(1, t.research / def.cost) : 0,
      stock: { food: Math.round(t.stock.food), wood: Math.round(t.stock.wood), stone: Math.round(t.stock.stone), ore: Math.round(t.stock.ore) },
      culture: { ...t.culture }, archetype: t.archetype, government: t.government, traditions: t.traditions.slice(),
      leaderId: t.leaderId, leaderName: t.leaderName, collapsed: t.collapsed, collapsedTick: t.collapsedTick,
      relations: rels, homeX: t.homeX, homeY: t.homeY, history: t.history.slice(),
    };
  }

  settlementView(s: Settlement): SettlementView {
    const t = this.tribeById.get(s.tribeId);
    return {
      id: s.id, tribeId: s.tribeId, name: s.name, x: s.x, y: s.y, tier: s.tier, health: s.health, population: s.population,
      hue: t?.hue ?? 0, founded: s.founded, destroyed: s.destroyed, walls: s.walls, farms: s.farms.length,
    };
  }

  serialize() {
    return {
      tribes: this.tribes.map((t) => JSON.parse(JSON.stringify(t))),
      settlements: this.settlements.map((s) => ({ ...s, farms: s.farms.slice() })),
      relations: [...this.relations.values()].map((r) => ({ ...r })),
      nextTribeId: this.nextTribeId,
      nextSettlementId: this.nextSettlementId,
      pass: this.pass,
      firstTech: [...this.firstTech],
      firstTier: [...this.firstTier],
    };
  }

  static deserialize(d: ReturnType<CivManager['serialize']>): CivManager {
    const m = new CivManager();
    m.tribes = d.tribes;
    m.settlements = d.settlements;
    for (const t of m.tribes) m.tribeById.set(t.id, t);
    for (const s of m.settlements) m.settlementById.set(s.id, s);
    for (const r of d.relations) m.relations.set(m.key(r.a, r.b), r as DiploRel);
    m.nextTribeId = d.nextTribeId;
    m.nextSettlementId = d.nextSettlementId;
    m.pass = d.pass;
    m.firstTech = new Set(d.firstTech);
    m.firstTier = new Set(d.firstTier);
    m.territoryDirty = true;
    return m;
  }
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
export { CIV_INTERVAL, genomeToRecord };
