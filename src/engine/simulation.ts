import { Rng } from './rng';
import { World } from './world/world';
import { generateWorld, DEFAULT_WORLDGEN, classifyBiomes, computeFertility } from './world/worldgen';
import { Climate } from './world/climate';
import { updateVegetation, VegetationResult } from './world/vegetation';
import { BIOMES, Biome } from './world/biomes';
import { Creature, derivePhenotype } from './creatures/creature';
import { updateCreature, speciesLabel } from './creatures/behavior';
import { creatureName, landmassName } from './creatures/names';
import { genomeFromTemplate, inherit, Genome, G, GENE_COUNT, GENES, genomeToRecord, geneticDistance } from './creatures/genome';
import { SpeciesRegistry } from './evolution/species';
import { CivManager } from './civ/civilization';
import { SpatialHash } from './spatial';
import { EventLog } from './events';
import { StatsTracker } from './stats';
import { applyCommand, rollNaturalDisasters } from './disasters';
import { evaluateObjectives, initObjectives, ObjectiveState } from './objectives';
import { upgradeState } from './saveUpgrade';
import { ScenarioConfig, TEMPLATES } from './scenarios';
import {
  ARCHIVE_MAX, BIRTH_COST_FATHER, BIRTH_COST_MOTHER, CARCASS_DECAY, CARCASS_MEAT_PER_SIZE, CIV_INTERVAL,
  MATE_MAX_DISTANCE, MAX_POPULATION, SAVE_VERSION, SPATIAL_CELL, SPECIATION_INTERVAL, STATS_INTERVAL,
  TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON, VEG_INTERVAL, DAYS_PER_SEASON,
} from './constants';
import type {
  ArchivedCreature, CreatureDetail, EnvironmentView, FamilyNode, GodCommand, SimSettings, StatsSummary,
} from './types';

export interface Carcass { id: number; x: number; y: number; meat: number; size: number }
export type FxKind = 'lightning' | 'quake' | 'meteor' | 'volcano' | 'fire' | 'plague' | 'spawn' | 'bless' | 'bloom' | 'blight' | 'birth' | 'death';
export interface Fx { kind: FxKind; x: number; y: number; r: number; tick: number }

import { FRAME_STRIDE, FLAG } from './frame';
import { dist2d } from './mathutil';
export { FRAME_STRIDE, FLAG };

const WORLD_ARRAYS = ['elevation', 'moisture', 'baseTemp', 'biome', 'river', 'fertility', 'veg', 'waterDist', 'landmass', 'ore', 'fire', 'farm', 'territory', 'rain', 'lake'] as const;

export class Simulation {
  seed: string;
  tick = 0;
  rng: Rng;
  world: World;
  climate = new Climate();
  creatures: Creature[] = [];
  byId = new Map<number, Creature>();
  nextId = 1;
  spatial: SpatialHash;
  species = new SpeciesRegistry();
  civ = new CivManager();
  events = new EventLog();
  stats = new StatsTracker();
  archive = new Map<number, ArchivedCreature>();
  carcasses: Carcass[] = [];
  carcassMap = new Map<number, Carcass>();
  nextCarcassId = 1;
  settings: SimSettings;
  scenario: ScenarioConfig;
  queue: GodCommand[] = [];
  newborns: Creature[] = [];
  fx: Fx[] = [];
  lastVeg: VegetationResult = { burning: 0, total: 0, capacity: 1 };

  birthsPeriod = 0;
  deathsPeriod = 0;
  deathAgePeriod = 0;
  mutationsPeriod = 0;
  infectionsPeriod = 0;
  foodEatenPeriod = 0;
  totalBirths = 0;
  totalDeaths = 0;
  deathCauses: Record<string, number> = {};
  maxGeneration = 0;
  popRecord = 0;
  generationMilestone = 0;
  lastClimateEventOffset = 0;
  epidemicReported = 0;
  extinctionReported = false;
  /** Causal bookkeeping: the events behind ongoing conditions. */
  droughtEventId = -1;
  droughtEndTick = -1e9;
  plagueEventId = -1;
  wasDrought = false;
  /** Chronicle throttle for notable individuals: "kind:speciesId" -> tick of the last announcement. */
  notableTick: Record<string, number> = {};
  objectives: ObjectiveState[] = [];
  /** Optional per-phase timing (ms accumulated), enabled by setting to {}. */
  prof: Record<string, number> | null = null;

  private constructor(seed: string, rng: Rng, world: World, scenario: ScenarioConfig) {
    this.seed = seed;
    this.rng = rng;
    this.world = world;
    this.scenario = scenario;
    this.spatial = new SpatialHash(world.width, world.height, SPATIAL_CELL);
    this.settings = {
      foodMult: scenario.settings.foodMult,
      mutationRate: scenario.settings.mutationRate,
      disasterRate: scenario.settings.disasterRate,
      disasterRamp: scenario.settings.disasterRamp,
    };
    this.climate.tempOffset = scenario.settings.tempOffset;
    this.climate.rainMult = scenario.settings.rainMult;
    if (scenario.climate) {
      this.climate.tempTrend = scenario.climate.tempTrend ?? 0;
      this.climate.trendLimit = scenario.climate.trendLimit ?? 0;
      this.climate.storminess = scenario.climate.storminess ?? 1;
    }
  }

  // ------------------------------------------------------------------ Creation

  static create(scenario: ScenarioConfig, seed: string): Simulation {
    const rng = new Rng(seed);
    const params = { ...DEFAULT_WORLDGEN, ...scenario.world };
    const world = generateWorld(params, rng.fork(1));
    const sim = new Simulation(seed, rng, world, scenario);
    if (sim.climate.tempOffset !== 0) {
      classifyBiomes(world, sim.climate.tempOffset);
      world.computeWaterDistance();
      computeFertility(world);
      sim.climate.lastClassifiedOffset = sim.climate.tempOffset;
    }
    sim.lastClimateEventOffset = sim.climate.globalOffset();
    const used: { x: number; y: number }[] = [];
    for (const spec of scenario.species) {
      const t = TEMPLATES[spec.template];
      if (!t) continue;
      const genes = { ...t.genes, ...(spec.genes ?? {}) };
      const base = genomeFromTemplate(genes, rng, 0);
      base[G.hue] = ((base[G.hue] + rng.gauss(0, 0.04)) % 1 + 1) % 1;
      const sp = sim.species.create(rng, Array.from(base), -1, 0, 'primordial');
      const sites: { x: number; y: number; n: number }[] = [];
      if (scenario.perIsland) {
        const islands = world.landmasses.filter((l) => l.size > 150);
        for (const isl of islands) {
          const site = sim.findSpawnSite(base, used, isl.id);
          sites.push({ ...site, n: spec.count });
        }
      } else {
        const herds = Math.max(1, spec.herds ?? 3);
        const carnivore = base[G.diet] > 0.6;
        for (let h = 0; h < herds; h++) {
          // Predators start near existing prey herds; everyone else spreads out.
          let site = sim.findSpawnSite(base, used);
          if (carnivore && used.length > 0) {
            const near = used[rng.int(0, used.length - 1)];
            const a = rng.next() * Math.PI * 2;
            site = world.nearestLand(near.x + Math.cos(a) * rng.range(8, 16), near.y + Math.sin(a) * rng.range(8, 16), 20) ?? site;
          }
          sites.push({ ...site, n: Math.round(spec.count / herds) });
        }
      }
      for (const site of sites) {
        used.push(site);
        for (let k = 0; k < site.n; k++) {
          const g = genomeFromTemplate(genes, rng, 0.045);
          g[G.hue] = ((base[G.hue] + rng.gauss(0, 0.02)) % 1 + 1) % 1;
          const p = world.nearestLand(site.x + rng.range(-3, 3), site.y + rng.range(-3, 3), 8) ?? site;
          sim.addCreature(g, p.x, p.y, sp.id, 0, null, null, true);
        }
      }
    }
    sim.species.refresh(sim.creatures, 0);
    sim.lastVeg = updateVegetation(world, sim.climate, rng, 0, sim.settings.foodMult);
    sim.stats.sample(sim);
    sim.objectives = initObjectives(sim, scenario.objectives);
    sim.events.push({
      tick: 0, cat: 'milestone', level: 3, title: 'A world is born',
      text: `${scenario.name}: ${world.landmasses.filter((l) => l.size > 100).length} landmasses rise from the sea. ${sim.creatures.length} creatures of ${sim.species.list.length} species awaken.`,
    });
    return sim;
  }

  /** Find a hospitable spot for a genome, away from other spawn sites. */
  findSpawnSite(genome: ArrayLike<number>, avoid: { x: number; y: number }[] = [], landmass = -1): { x: number; y: number } {
    const w = this.world, rng = this.rng;
    const low = 8 - 30 * genome[G.coldTol], high = 25 + 20 * genome[G.heatTol];
    const carn = genome[G.diet] > 0.6;
    let bx = w.width / 2, by = w.height / 2, bs = -Infinity;
    for (let k = 0; k < 120; k++) {
      const x = rng.range(2, w.width - 2), y = rng.range(2, w.height - 2);
      const i = w.tileAt(x, y);
      if (!w.isLand(i) || w.biome[i] === Biome.Glacier || w.biome[i] === Biome.SnowPeak) continue;
      if (landmass >= 0 && w.landmass[i] !== landmass) continue;
      const temp = w.baseTemp[i] + this.climate.globalOffset();
      let s = (carn ? 0.6 : 2) * w.fertility[i] - w.waterDist[i] * 0.08 - Math.max(0, low - temp) * 0.15 - Math.max(0, temp - high) * 0.15 + rng.next() * 0.3;
      for (const a of avoid) {
        const d = dist2d(a.x - x, a.y - y);
        if (d < 25) s -= (25 - d) * 0.06;
      }
      if (s > bs) { bs = s; bx = x; by = y; }
    }
    return { x: Math.floor(bx) + 0.5, y: Math.floor(by) + 0.5 };
  }

  addCreature(genome: Genome, x: number, y: number, speciesId: number, generation: number, mother: Creature | null, father: Creature | null, initial = false): Creature {
    const rng = this.rng;
    const c = new Creature(this.nextId++, genome, x, y, speciesId, rng.chance(0.5) ? 0 : 1);
    const sp = this.species.get(speciesId);
    c.name = creatureName(rng, sp?.lang ?? [0, 1, 2, 3, 4, 5, 6]);
    c.generation = generation;
    c.birthTick = this.tick;
    c.heading = rng.next() * Math.PI * 2;
    c.decideIn = rng.int(0, 6);
    const tile = this.world.tileAt(x, y);
    if (initial) {
      c.age = rng.int(Math.round(c.maturity * 0.6), Math.round(c.lifespan * 0.45));
      c.energy = c.maxEnergy * rng.range(0.6, 0.9);
      c.hydration = rng.range(0.7, 1);
      c.cooldown = rng.int(0, c.reproCooldown);
      c.remember(this.tick, 'born', `Awoke in the ${BIOMES[this.world.biome[tile]].name.toLowerCase()}`);
    } else {
      c.energy = c.maxEnergy * 0.6;
      c.hydration = 0.9;
      c.remember(this.tick, 'born', `Born to ${mother?.name ?? '?'} and ${father?.name ?? '?'} in the ${BIOMES[this.world.biome[tile]].name.toLowerCase()}`);
    }
    const lm = this.world.landmass[tile];
    c.lastLandmass = lm;
    if (sp) {
      sp.totalBorn++;
      if (generation > sp.generationMax) sp.generationMax = generation;
      if (lm >= 0 && !sp.landmasses.includes(lm)) sp.landmasses.push(lm);
    }
    if (generation > this.maxGeneration) this.maxGeneration = generation;
    this.byId.set(c.id, c);
    if (initial && this.tick === 0) this.creatures.push(c);
    else this.newborns.push(c);
    return c;
  }

  // ------------------------------------------------------------------ Life & death

  tryMate(a: Creature, b: Creature): boolean {
    if (a.sex === b.sex || !a.alive || !b.alive) return false;
    const mother = a.sex === 0 ? a : b;
    const father = mother === a ? b : a;
    if (mother.cooldown > 0 || father.cooldown > 0) return false;
    if (this.creatures.length + this.newborns.length >= MAX_POPULATION) return false;
    if (geneticDistance(mother.genome, father.genome) >= MATE_MAX_DISTANCE) return false;
    const costPer = BIRTH_COST_MOTHER * mother.size;
    const spare = mother.energy - mother.maxEnergy * 0.25;
    const n = Math.min(mother.litter, Math.floor(spare / costPer));
    if (n <= 0) return false;
    const rng = this.rng;
    // Crowded households have fewer children: housing feeds back on births.
    if (mother.homeId >= 0) {
      const hs = this.civ.settlement(mother.homeId);
      if (hs && hs.econ.crowding > 1.25 && rng.chance(0.5)) { mother.cooldown = Math.round(mother.reproCooldown * 0.3); return false; }
    }
    const kids: Creature[] = [];
    for (let k = 0; k < n; k++) {
      const g = new Float32Array(GENE_COUNT);
      const muts = inherit(mother.genome, father.genome, rng, this.settings.mutationRate, g);
      this.mutationsPeriod += muts;
      const p = this.world.nearestLand(mother.x + rng.range(-0.8, 0.8), mother.y + rng.range(-0.8, 0.8), 4) ?? { x: mother.x, y: mother.y };
      const child = this.addCreature(g, p.x, p.y, mother.speciesId, Math.max(mother.generation, father.generation) + 1, mother, father);
      child.motherId = mother.id;
      child.fatherId = father.id;
      child.addRelation(mother.id, 'mother', 0.9);
      child.addRelation(father.id, 'father', 0.6);
      mother.addRelation(child.id, 'child', 0.9);
      father.addRelation(child.id, 'child', 0.6);
      mother.children.push(child.id);
      father.children.push(child.id);
      const tribe = mother.tribeId >= 0 ? mother.tribeId : father.tribeId;
      if (tribe >= 0) {
        child.tribeId = tribe;
        child.homeId = mother.tribeId === tribe ? mother.homeId : father.homeId;
      }
      // Born on the road: the child travels with its mother's group.
      const grp = mother.migrationId >= 0 ? this.civ.group(mother.migrationId) : undefined;
      if (grp && child.tribeId === grp.tribeId) {
        child.migrationId = grp.id;
        child.homeId = -1;
        grp.members.push(child.id);
      }
      kids.push(child);
      this.birthsPeriod++;
      this.totalBirths++;
    }
    for (const k of kids) for (const s of kids) if (k !== s) k.addRelation(s.id, 'sibling', 0.5);
    mother.energy -= costPer * n;
    father.energy -= BIRTH_COST_FATHER * father.size;
    mother.cooldown = mother.reproCooldown;
    father.cooldown = Math.round(father.reproCooldown * 0.6);
    mother.mateId = father.id;
    father.mateId = mother.id;
    mother.addRelation(father.id, 'mate', 0.5);
    father.addRelation(mother.id, 'mate', 0.5);
    const names = kids.map((k) => k.name).join(', ');
    mother.remember(this.tick, 'birth', `Gave birth to ${names} with ${father.name}`);
    father.remember(this.tick, 'birth', `Fathered ${names} with ${mother.name}`);
    return true;
  }

  kill(c: Creature, cause: string, killer?: Creature): void {
    if (!c.alive) return;
    c.alive = false;
    c.health = 0;
    this.deathsPeriod++;
    this.totalDeaths++;
    this.deathAgePeriod += c.age;
    const key = cause.startsWith('killed by') ? 'predation' : cause;
    this.deathCauses[key] = (this.deathCauses[key] ?? 0) + 1;
    const meat = CARCASS_MEAT_PER_SIZE * c.effSize;
    const carcass: Carcass = { id: this.nextCarcassId++, x: c.x, y: c.y, meat, size: c.effSize };
    this.carcasses.push(carcass);
    this.carcassMap.set(carcass.id, carcass);
    if (killer) {
      killer.kills++;
      if (killer.tribeId >= 0 && killer.job === 'hunt') {
        const take = Math.min(carcass.meat * 0.7, 10 * killer.size);
        carcass.meat -= take;
        killer.carry = take * 0.75;
        killer.carryKind = 'food';
        killer.action = 'work';
        killer.targetId = -9;
        killer.goal = `Carrying ${c.name}'s carcass home`;
      } else if (killer.meatEff > 0.15) {
        killer.action = 'scavenge';
        killer.targetId = carcass.id;
        killer.tx = c.x; killer.ty = c.y;
        killer.goal = `Feeding on ${c.name}`;
      }
      if (killer.kills === 1 || killer.kills % 10 === 0) killer.remember(this.tick, 'kill', `Killed ${c.name} the ${speciesLabel(this, c.speciesId)}${killer.kills > 1 ? ` (${killer.kills} kills)` : ''}`);
    }
    for (const r of c.relations) {
      if (r.kind !== 'mate' && r.kind !== 'child' && r.kind !== 'mother' && r.kind !== 'father') continue;
      const o = this.byId.get(r.id);
      if (!o || !o.alive) continue;
      const label = r.kind === 'mate' ? 'mate' : r.kind === 'child' ? (c.sex === 0 ? 'mother' : 'father') : c.sex === 0 ? 'daughter' : 'son';
      o.remember(this.tick, 'loss', `Lost ${label} ${c.name} (${cause})`);
      if (o.mateId === c.id) o.mateId = -1;
    }
    if (c.tribeId >= 0 || c.migrationId >= 0) this.civ.onDeath(c, !!killer);
    this.archiveCreature(c, cause);
    this.byId.delete(c.id);
  }

  private archiveCreature(c: Creature, cause: string): void {
    const notable = c.title !== '' || c.kills > 3 || c.children.length > 6;
    this.archive.set(c.id, {
      id: c.id, name: c.name, speciesId: c.speciesId, generation: c.generation, sex: c.sex,
      motherId: c.motherId, fatherId: c.fatherId, children: c.children.slice(-24), birthTick: c.birthTick,
      deathTick: this.tick, cause, hue: c.genome[G.hue], kills: c.kills, title: c.title,
      memories: notable ? c.memories.slice() : c.memories.slice(-10), genome: Array.from(c.genome),
      tribeId: c.tribeId, x: c.x, y: c.y, maxTravel: c.maxTravel, distance: c.distance,
    });
    if (this.archive.size > ARCHIVE_MAX) {
      const first = this.archive.keys().next().value;
      if (first !== undefined) this.archive.delete(first);
    }
  }

  nearestCarcass(x: number, y: number, r: number): Carcass | null {
    let best: Carcass | null = null, bd = r * r;
    for (const k of this.carcasses) {
      const d = (k.x - x) ** 2 + (k.y - y) ** 2;
      if (d < bd && k.meat > 1) { bd = d; best = k; }
    }
    return best;
  }

  carcassById(id: number): Carcass | null {
    const k = this.carcassMap.get(id);
    return k && k.meat > 0 ? k : null;
  }

  onLandmassVisit(c: Creature, lm: number): void {
    const sp = this.species.get(c.speciesId);
    if (!sp || sp.landmasses.includes(lm)) return;
    sp.landmasses.push(lm);
    const land = this.world.landmasses[lm];
    if (!land || land.size < 40) return;
    c.remember(this.tick, 'discovery', `Became the first ${sp.common} to set foot on ${land.name}`);
    if (!c.title) c.title = 'Pioneer';
    this.events.push({
      tick: this.tick, cat: 'creature', level: 2, title: 'New territory discovered',
      text: `${c.name} became the first ${sp.common} to reach ${land.name}.`, x: c.x, y: c.y, creatureId: c.id, speciesId: sp.id,
    });
  }

  // ------------------------------------------------------------------ Tick

  queueCommand(cmd: GodCommand): void {
    this.queue.push(cmd);
  }

  step(): void {
    this.tick++;
    const tick = this.tick;
    if (this.queue.length) {
      const q = this.queue;
      this.queue = [];
      for (const cmd of q) applyCommand(this, cmd);
    }
    const P = this.prof;
    let t0 = P ? performance.now() : 0;
    const mark = (k: string) => { if (P) { const t = performance.now(); P[k] = (P[k] ?? 0) + t - t0; t0 = t; } };
    this.climate.update(this.world, this.rng, tick);
    if (tick % VEG_INTERVAL === 0) this.lastVeg = updateVegetation(this.world, this.climate, this.rng, tick, this.settings.foodMult);
    mark('world');
    this.spatial.rebuild(this.creatures);
    mark('spatial');
    const cs = this.creatures;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.alive) updateCreature(this, c);
    }
    mark('creatures');
    // Compact the dead and add newborns.
    let j = 0;
    for (let i = 0; i < cs.length; i++) if (cs[i].alive) cs[j++] = cs[i];
    cs.length = j;
    if (this.newborns.length) {
      for (const n of this.newborns) if (n.alive) cs.push(n);
      this.newborns.length = 0;
    }
    if (tick % 10 === 0 && this.carcasses.length) {
      let k = 0;
      for (const cc of this.carcasses) {
        cc.meat -= CARCASS_DECAY * 10 * (1 + cc.size * 0.2);
        if (cc.meat > 0.5) this.carcasses[k++] = cc;
        else this.carcassMap.delete(cc.id);
      }
      this.carcasses.length = k;
    }
    mark('misc');
    if (tick % CIV_INTERVAL === 0) this.civ.update(this);
    mark('civ');
    if (tick % SPECIATION_INTERVAL === 0) this.speciationPass();
    if (tick % STATS_INTERVAL === 0) this.statsPass();
    if (tick % TICKS_PER_DAY === 0) this.dailyPass();
    mark('periodic');
    if (this.fx.length > 200) this.fx.splice(0, this.fx.length - 200);
  }

  private speciationPass(): void {
    const splits = this.species.speciate(this.creatures, this.world, this.rng, this.tick);
    for (const s of splits) {
      const m = s.members[0];
      const how = s.origin === 'allopatric'
        ? `isolated on ${this.world.landmasses[this.world.landmass[this.world.tileAt(m.x, m.y)]]?.name ?? 'distant shores'}`
        : 'diverging within its range';
      const diff = describeDivergence(s.parent.centroid, s.child.centroid);
      this.events.push({
        tick: this.tick, cat: 'species', level: 3, title: 'A new species has emerged',
        text: `${s.child.name} (${s.child.common}) branched from ${s.parent.name} after ${how}${diff ? ` — ${diff}` : ''}.`,
        x: m.x, y: m.y, speciesId: s.child.id,
      });
      for (const c of s.members.slice(0, 12)) c.remember(this.tick, 'species', `Recognised as ${s.child.name}, a new species`);
    }
  }

  private statsPass(): void {
    const extinct = this.species.refresh(this.creatures, this.tick);
    for (const s of extinct) {
      this.events.push({
        tick: this.tick, cat: 'species', level: s.peak >= 30 ? 3 : 2, title: 'Extinction',
        text: `${s.name} (${s.common}) has gone extinct after ${((this.tick - s.originTick) / TICKS_PER_YEAR).toFixed(1)} years. Its peak population was ${s.peak}.`,
        speciesId: s.id,
      });
    }
    this.stats.sample(this);
    if (this.objectives.length) evaluateObjectives(this);
    const n = this.creatures.length;
    // Population crash / boom detection per species.
    const hist = this.stats.speciesHistory;
    for (const s of this.species.list) {
      if (s.extinctTick !== null) continue;
      const h = hist[s.id];
      if (!h || h.length < 5) continue;
      const prev = h[h.length - 5];
      if (prev >= 30 && s.population < prev * 0.55 && this.tick - s.refTick > TICKS_PER_DAY * 3) {
        s.refTick = this.tick;
        this.events.push({ tick: this.tick, cat: 'species', level: 2, title: 'Population collapse', text: `${s.common}s are dying out fast: ${prev} → ${s.population} in two days.`, speciesId: s.id });
      } else if (s.population >= 60 && prev > 0 && s.population > prev * 1.8 && this.tick - s.refTick > TICKS_PER_DAY * 4) {
        s.refTick = this.tick;
        this.events.push({ tick: this.tick, cat: 'species', level: 1, title: 'Population boom', text: `${s.common}s are thriving: ${prev} → ${s.population}.`, speciesId: s.id });
      }
    }
    // Notable individuals keep their titles; the chronicle announces each kind at most once per species per season.
    const announce = (kind: string, c: Creature): boolean => {
      const k = `${kind}:${c.speciesId}`;
      if (this.tick - (this.notableTick[k] ?? -1e9) < TICKS_PER_SEASON) return false;
      this.notableTick[k] = this.tick;
      return true;
    };
    for (const c of this.creatures) {
      if (c.kills >= 8 && !(c.flags & 2)) {
        c.flags |= 2;
        c.title = 'Apex Predator';
        if (announce('predator', c)) this.events.push({ tick: this.tick, cat: 'creature', level: 2, title: 'A major predator has appeared', text: `${c.name} the ${speciesLabel(this, c.speciesId)} has claimed ${c.kills} lives and rules the land around it.`, x: c.x, y: c.y, creatureId: c.id, speciesId: c.speciesId });
      }
      if (c.maxTravel > this.world.width * 0.4 && !(c.flags & 1)) {
        c.flags |= 1;
        if (!c.title) c.title = 'Wanderer';
        c.remember(this.tick, 'journey', `Completed an extraordinary journey of ${Math.round(c.maxTravel)} leagues`);
        if (announce('journey', c)) this.events.push({ tick: this.tick, cat: 'creature', level: 2, title: 'An extraordinary journey', text: `${c.name} the ${speciesLabel(this, c.speciesId)} has wandered ${Math.round(c.maxTravel)} leagues from its birthplace.`, x: c.x, y: c.y, creatureId: c.id, speciesId: c.speciesId });
      }
      if (c.children.length >= 14 && !(c.flags & 4)) {
        c.flags |= 4;
        if (!c.title) c.title = c.sex === 0 ? 'Matriarch' : 'Patriarch';
        if (announce('parent', c)) this.events.push({ tick: this.tick, cat: 'creature', level: 1, title: c.sex === 0 ? 'A great matriarch' : 'A great patriarch', text: `${c.name} the ${speciesLabel(this, c.speciesId)} has raised ${c.children.length} offspring.`, x: c.x, y: c.y, creatureId: c.id, speciesId: c.speciesId });
      }
    }
    // Milestones.
    const milestones = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000];
    const next = milestones.find((m) => m > this.generationMilestone);
    if (next && this.maxGeneration >= next) {
      this.generationMilestone = next;
      this.events.push({ tick: this.tick, cat: 'milestone', level: 2, title: `Generation ${next}`, text: `The ${next}th generation of life has been born.` });
    }
    if (n > this.popRecord + 500 || (this.popRecord === 0 && n > 0)) {
      if (this.popRecord > 0 && Math.floor(n / 500) > Math.floor(this.popRecord / 500)) {
        this.events.push({ tick: this.tick, cat: 'milestone', level: 1, title: 'Population record', text: `The world now teems with ${n} creatures.` });
      }
      this.popRecord = Math.max(this.popRecord, n);
    }
    const infected = this.stats.latest.infected ?? 0;
    if (infected > 25 && this.tick - this.epidemicReported > TICKS_PER_DAY * 5) {
      this.epidemicReported = this.tick;
      this.events.push({ tick: this.tick, cat: 'disaster', level: 2, title: 'Epidemic', text: `Disease is spreading: ${infected} creatures are infected.` });
    }
    if (n === 0 && !this.extinctionReported && this.tick > 0) {
      this.extinctionReported = true;
      this.events.push({ tick: this.tick, cat: 'milestone', level: 3, title: 'Silence', text: 'The last creature has died. The world is empty — but the plants grow on. Introduce new life to begin again.' });
    } else if (n > 0) this.extinctionReported = false;
  }

  private dailyPass(): void {
    const tick = this.tick;
    const day = Math.floor(tick / TICKS_PER_DAY);
    if (this.settings.disasterRamp > 0) this.settings.disasterRate += this.settings.disasterRamp / (DAYS_PER_SEASON * 4);
    for (const item of this.scenario.schedule ?? []) if (item.day === day) applyCommand(this, item.cmd);
    rollNaturalDisasters(this);
    const drought = this.climate.droughtTicks > 0;
    if (this.wasDrought && !drought) this.droughtEndTick = tick;
    this.wasDrought = drought;
    // Climate shifts move biome boundaries (glaciers advance/retreat).
    const off = this.climate.globalOffset();
    if (Math.abs(off - this.climate.lastClassifiedOffset) >= 1.5) {
      this.climate.lastClassifiedOffset = off;
      classifyBiomes(this.world, off);
      this.terrainChanged(false);
    }
    if (Math.abs(off - this.lastClimateEventOffset) >= 3) {
      const colder = off < this.lastClimateEventOffset;
      this.lastClimateEventOffset = off;
      this.events.push({
        tick, cat: 'climate', level: 2, title: colder ? 'The world grows colder' : 'The world grows warmer',
        text: colder ? `Global temperatures have fallen to ${off.toFixed(1)}°C below normal. Glaciers are advancing.` : `Global temperatures are now ${off > 0 ? '+' : ''}${off.toFixed(1)}°C from normal. Ice is retreating and deserts spread.`,
      });
    }
    if (day % (DAYS_PER_SEASON * 4) === 0 && day > 0) {
      const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
      const alive = this.species.alive().filter((s) => s.population > 0).length;
      this.events.push({ tick, cat: 'milestone', level: 1, title: `Year ${year}`, text: `Year ${year} begins: ${this.creatures.length} creatures of ${alive} species, ${this.civ.activeTribes().length} tribes.` });
    }
  }

  /** Recompute derived terrain data after deformation or climate shift. */
  terrainChanged(relabel = true): void {
    const w = this.world;
    if (relabel) classifyBiomes(w, this.climate.lastClassifiedOffset);
    w.computeWaterDistance();
    const farms: number[] = [];
    for (let i = 0; i < w.size; i++) if (w.farm[i]) farms.push(i);
    computeFertility(w);
    for (const i of farms) if (w.isLand(i)) w.fertility[i] = Math.max(w.fertility[i], 0.5); else w.farm[i] = 0;
    for (let i = 0; i < w.size; i++) if (w.isWater(i)) { w.veg[i] = 0; w.fire[i] = 0; }
    const old = w.landmass.slice();
    const oldList = w.landmasses;
    w.computeLandmasses(() => '');
    // Inherit names from the old landmass with the largest overlap.
    const usedNames = new Set<string>();
    for (const lm of w.landmasses.slice().sort((a, b) => b.size - a.size)) {
      const counts = new Map<number, number>();
      for (let i = 0; i < w.size; i++) if (w.landmass[i] === lm.id && old[i] >= 0) counts.set(old[i], (counts.get(old[i]) ?? 0) + 1);
      let best = -1, bc = 0;
      for (const [k, v] of counts) if (v > bc) { bc = v; best = k; }
      const nm = best >= 0 ? oldList[best]?.name : undefined;
      if (nm && !usedNames.has(nm)) { lm.name = nm; usedNames.add(nm); }
      else lm.name = landmassName(this.rng, lm.size);
    }
    w.terrainVersion++;
    this.civ.territoryDirty = true;
  }

  avgTemperature(): number {
    let t = 0;
    const w = this.world;
    const ys = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const fy of ys) {
      const y = Math.floor(fy * (w.height - 1));
      t += this.climate.tileTemp(w, w.idx(Math.floor(w.width / 2), y), this.tick) - this.climate.sun(this.tick) * 2.5;
    }
    return t / ys.length;
  }

  // ------------------------------------------------------------------ Views

  packFrame(buf: Float32Array): number {
    let o = 0;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      if (o + FRAME_STRIDE > buf.length) break;
      let flags = 0;
      if (c.resting) flags |= FLAG.resting;
      if (c.action === 'flee') flags |= FLAG.fleeing;
      if (c.action === 'hunt') flags |= FLAG.hunting;
      if (!c.mature) flags |= FLAG.young;
      if (c.infection > 0) flags |= FLAG.infected;
      if (c.tribeId >= 0) flags |= FLAG.tribe;
      if (c.title) flags |= FLAG.notable;
      if (c.carry > 0) flags |= FLAG.carrying;
      if (c.job === 'raid' && c.action === 'work') flags |= FLAG.raiding;
      if (c.action === 'mate') flags |= FLAG.mating;
      if (c.sex === 0) flags |= FLAG.female;
      const tribe = c.tribeId >= 0 ? this.civ.tribe(c.tribeId) : undefined;
      buf[o] = c.id;
      buf[o + 1] = c.x;
      buf[o + 2] = c.y;
      buf[o + 3] = c.heading;
      buf[o + 4] = c.effSize;
      buf[o + 5] = c.genome[G.hue];
      buf[o + 6] = c.genome[G.saturation];
      buf[o + 7] = c.genome[G.pattern];
      buf[o + 8] = c.genome[G.shape];
      buf[o + 9] = c.diet;
      buf[o + 10] = flags;
      buf[o + 11] = tribe ? tribe.hue : -1;
      o += FRAME_STRIDE;
    }
    return o / FRAME_STRIDE;
  }

  environment(): EnvironmentView {
    const cl = this.climate, tick = this.tick;
    const yearTick = tick % TICKS_PER_YEAR;
    return {
      tick,
      year: Math.floor(tick / TICKS_PER_YEAR) + 1,
      season: cl.season(tick),
      day: Math.floor((yearTick % (TICKS_PER_DAY * DAYS_PER_SEASON)) / TICKS_PER_DAY) + 1,
      dayPhase: cl.dayPhase(tick),
      daylight: cl.daylight(tick),
      globalTemp: cl.globalOffset(),
      avgTemp: this.stats.latest.temperature ?? 0,
      rainfall: cl.effectiveRain(),
      tempOffset: cl.tempOffset,
      drift: cl.drift + cl.impactWinter,
      rainMult: cl.rainMult,
      foodMult: this.settings.foodMult,
      mutationRate: this.settings.mutationRate,
      disasterRate: this.settings.disasterRate,
      droughtDays: Math.ceil(cl.droughtTicks / TICKS_PER_DAY),
      vegetation: this.lastVeg.capacity > 0 ? this.lastVeg.total / this.lastVeg.capacity : 0,
      burning: this.lastVeg.burning,
      ecoHealth: this.stats.latest.ecoHealth ?? 0,
    };
  }

  summary(): StatsSummary {
    const l = this.stats.latest;
    const alive = this.species.alive().filter((s) => s.population > 0);
    return {
      population: this.creatures.length,
      speciesAlive: alive.length,
      speciesTotal: this.species.list.length,
      births: l.births ?? 0,
      deaths: l.deaths ?? 0,
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      avgLifespanDays: l.avgLifespan ?? 0,
      avgIntelligence: l.avgIntelligence ?? 0,
      biodiversity: l.biodiversity ?? 0,
      geneticDiversity: l.geneticDiversity ?? 0,
      mutationsPerBirth: l.mutations ?? 0,
      tribes: this.civ.activeTribes().length,
      settlements: this.civ.activeSettlements().length,
      maxGeneration: this.maxGeneration,
      herbivores: l.herbivores ?? 0,
      omnivores: l.omnivores ?? 0,
      carnivores: l.carnivores ?? 0,
      infected: l.infected ?? 0,
    };
  }

  creatureDetail(id: number): CreatureDetail | null {
    const c = this.byId.get(id);
    const w = this.world;
    if (c && c.alive) {
      const sp = this.species.get(c.speciesId);
      const tile = w.tileAt(c.x, c.y);
      const lm = w.landmass[tile];
      const tribe = c.tribeId >= 0 ? this.civ.tribe(c.tribeId) : undefined;
      const home = c.homeId >= 0 ? this.civ.settlement(c.homeId) : undefined;
      return {
        id: c.id, alive: true, name: c.name, speciesId: c.speciesId, speciesName: sp?.name ?? '?', speciesCommon: sp?.common ?? '?',
        sex: c.sex === 0 ? 'female' : 'male', generation: c.generation, x: c.x, y: c.y,
        biome: BIOMES[w.biome[tile]].name, landmass: lm >= 0 ? w.landmasses[lm]?.name ?? '' : 'At sea',
        ageDays: c.age / TICKS_PER_DAY, lifespanDays: c.lifespan / TICKS_PER_DAY, maturityDays: c.maturity / TICKS_PER_DAY,
        health: c.health, maxHealth: c.maxHealth, energy: c.energy, maxEnergy: c.maxEnergy, hydration: c.hydration,
        temperature: c.tempNow, comfortLow: c.comfortLow, comfortHigh: c.comfortHigh, action: c.action, goal: c.goal,
        genes: genomeToRecord(c.genome), personality: personality(c), hue: c.genome[G.hue], saturation: c.genome[G.saturation],
        pattern: c.genome[G.pattern], shape: c.genome[G.shape], size: c.effSize, diet: c.diet,
        tribe: tribe ? { id: tribe.id, name: tribe.name } : null, home: home ? { id: home.id, name: home.name } : null,
        job: c.job, title: c.title, kills: c.kills, children: c.children.length, distance: c.distance, maxTravel: c.maxTravel,
        infected: c.infection > 0, memories: c.memories.slice(), relations: this.relationViews(c.relations),
        family: this.familyTree(c.id, 2, 2), causeOfDeath: null, birthTick: c.birthTick, deathTick: null,
      };
    }
    const a = this.archive.get(id);
    if (!a) return null;
    const sp = this.species.get(a.speciesId);
    const g = Float32Array.from(a.genome);
    const tmp = new Creature(a.id, g, a.x, a.y, a.speciesId, a.sex as 0 | 1);
    derivePhenotype(tmp);
    const tribe = a.tribeId >= 0 ? this.civ.tribe(a.tribeId) : undefined;
    return {
      id: a.id, alive: false, name: a.name, speciesId: a.speciesId, speciesName: sp?.name ?? '?', speciesCommon: sp?.common ?? '?',
      sex: a.sex === 0 ? 'female' : 'male', generation: a.generation, x: a.x, y: a.y, biome: BIOMES[w.biome[w.tileAt(a.x, a.y)]].name,
      landmass: '', ageDays: (a.deathTick - a.birthTick) / TICKS_PER_DAY, lifespanDays: tmp.lifespan / TICKS_PER_DAY,
      maturityDays: tmp.maturity / TICKS_PER_DAY, health: 0, maxHealth: tmp.maxHealth, energy: 0, maxEnergy: tmp.maxEnergy,
      hydration: 0, temperature: 0, comfortLow: tmp.comfortLow, comfortHigh: tmp.comfortHigh, action: 'dead', goal: `Died: ${a.cause}`,
      genes: genomeToRecord(g), personality: personality(tmp), hue: g[G.hue], saturation: g[G.saturation], pattern: g[G.pattern],
      shape: g[G.shape], size: tmp.size, diet: tmp.diet, tribe: tribe ? { id: tribe.id, name: tribe.name } : null, home: null, job: null,
      title: a.title, kills: a.kills, children: a.children.length, distance: a.distance, maxTravel: a.maxTravel, infected: false,
      memories: a.memories.slice(), relations: [], family: this.familyTree(a.id, 2, 2), causeOfDeath: a.cause,
      birthTick: a.birthTick, deathTick: a.deathTick,
    };
  }

  private relationViews(rs: import('./types').Relation[]) {
    return rs.map((r) => {
      const o = this.byId.get(r.id);
      const a = o ? undefined : this.archive.get(r.id);
      return { id: r.id, name: o?.name ?? a?.name ?? 'Unknown', kind: r.kind, affinity: r.affinity, alive: !!o?.alive };
    }).sort((a, b) => kindRank(b.kind) - kindRank(a.kind) || b.affinity - a.affinity);
  }

  familyTree(id: number, up: number, down: number): FamilyNode {
    const live = this.byId.get(id);
    const arc = live ? undefined : this.archive.get(id);
    const node: FamilyNode = {
      id, name: live?.name ?? arc?.name ?? 'Unknown', alive: !!live?.alive, speciesId: live?.speciesId ?? arc?.speciesId ?? -1,
      hue: live ? live.genome[G.hue] : arc?.hue ?? 0, parents: [], children: [],
    };
    if (!live && !arc) return node;
    if (up > 0) {
      const m = live?.motherId ?? arc!.motherId, f = live?.fatherId ?? arc!.fatherId;
      if (m >= 0) node.parents.push(this.familyTree(m, up - 1, 0));
      if (f >= 0) node.parents.push(this.familyTree(f, up - 1, 0));
    }
    if (down > 0) {
      const kids = (live?.children ?? arc!.children).slice(-10);
      for (const k of kids) node.children.push(this.familyTree(k, 0, down - 1));
    }
    return node;
  }

  /** Nearest living creature to a point (for click selection). */
  pick(x: number, y: number, r: number): number {
    let best = -1, bd = r * r;
    for (const c of this.creatures) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  }

  stateHash(): number {
    let h = this.tick | 0;
    for (const c of this.creatures) {
      h = (Math.imul(h ^ Math.round(c.x * 1000), 16777619) ^ Math.round(c.energy * 100)) | 0;
    }
    for (const v of this.rng.getState()) h = Math.imul(h ^ v, 16777619) | 0;
    return h >>> 0;
  }

  // ------------------------------------------------------------------ Persistence

  serialize(): SimState {
    const w = this.world;
    const worldData: Record<string, unknown> = {
      width: w.width, height: w.height, seaLevel: w.seaLevel, terrainVersion: w.terrainVersion,
      landmasses: w.landmasses.map((l) => ({ ...l })),
    };
    for (const k of WORLD_ARRAYS) worldData[k] = (w[k] as ArrayLike<number> & { slice(): unknown }).slice();
    // The per-chunk food cache refreshes every few ticks; saving it keeps a resumed world identical between refreshes.
    worldData.chunkFood = w.chunkFood.slice();
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      tick: this.tick,
      rng: this.rng.getState(),
      scenario: this.scenario,
      settings: { ...this.settings },
      world: worldData,
      climate: this.climate.serialize(),
      creatures: this.creatures.map(serializeCreature),
      nextId: this.nextId,
      species: this.species.serialize(),
      civ: this.civ.serialize(),
      events: this.events.serialize(),
      stats: this.stats.serialize(),
      archive: [...this.archive.values()],
      carcasses: this.carcasses.map((c) => ({ ...c })),
      nextCarcassId: this.nextCarcassId,
      counters: {
        totalBirths: this.totalBirths, totalDeaths: this.totalDeaths, deathCauses: { ...this.deathCauses },
        maxGeneration: this.maxGeneration, popRecord: this.popRecord, generationMilestone: this.generationMilestone,
        lastClimateEventOffset: this.lastClimateEventOffset, epidemicReported: this.epidemicReported,
        birthsPeriod: this.birthsPeriod, deathsPeriod: this.deathsPeriod, deathAgePeriod: this.deathAgePeriod, mutationsPeriod: this.mutationsPeriod,
        droughtEventId: this.droughtEventId, droughtEndTick: this.droughtEndTick, plagueEventId: this.plagueEventId, wasDrought: this.wasDrought,
        notableTick: { ...this.notableTick },
      },
      lastVeg: { ...this.lastVeg },
      objectives: this.objectives.map((o) => JSON.parse(JSON.stringify(o))),
    };
  }

  static deserialize(input: SimState): Simulation {
    const s = upgradeState(input);
    const wd = s.world as Record<string, any>;
    const world = new World(wd.width, wd.height);
    world.seaLevel = wd.seaLevel;
    world.terrainVersion = wd.terrainVersion;
    world.landmasses = wd.landmasses;
    for (const k of WORLD_ARRAYS) {
      const src = wd[k];
      const dst = world[k] as unknown as { set(a: ArrayLike<number>): void };
      dst.set(src);
    }
    if (wd.chunkFood && wd.chunkFood.length === world.chunkFood.length) world.chunkFood.set(wd.chunkFood);
    else world.updateChunkFood();
    const rng = new Rng(0);
    rng.setState(s.rng);
    const sim = new Simulation(s.seed, rng, world, s.scenario);
    sim.tick = s.tick;
    sim.settings = { ...s.settings };
    sim.climate = Climate.deserialize(s.climate);
    sim.species = SpeciesRegistry.deserialize(s.species);
    sim.civ = CivManager.deserialize(s.civ);
    sim.events = EventLog.deserialize(s.events);
    sim.stats = StatsTracker.deserialize(s.stats);
    for (const a of s.archive) sim.archive.set(a.id, a);
    sim.carcasses = s.carcasses;
    for (const k of sim.carcasses) sim.carcassMap.set(k.id, k);
    sim.nextCarcassId = s.nextCarcassId;
    sim.nextId = s.nextId;
    Object.assign(sim, s.counters);
    sim.lastVeg = s.lastVeg;
    sim.objectives = s.objectives ?? [];
    for (const d of s.creatures) {
      const c = deserializeCreature(d);
      sim.creatures.push(c);
      sim.byId.set(c.id, c);
    }
    return sim;
  }
}

export interface SimState {
  version: number;
  seed: string;
  tick: number;
  rng: [number, number, number, number];
  scenario: ScenarioConfig;
  settings: SimSettings;
  world: Record<string, unknown>;
  climate: ReturnType<Climate['serialize']>;
  creatures: Record<string, unknown>[];
  nextId: number;
  species: ReturnType<SpeciesRegistry['serialize']>;
  civ: ReturnType<CivManager['serialize']>;
  events: ReturnType<EventLog['serialize']>;
  stats: ReturnType<StatsTracker['serialize']>;
  archive: ArchivedCreature[];
  carcasses: Carcass[];
  nextCarcassId: number;
  counters: Record<string, unknown>;
  lastVeg: VegetationResult;
  objectives?: ObjectiveState[];
}

function serializeCreature(c: Creature): Record<string, unknown> {
  const o: Record<string, unknown> = { ...c };
  o.genome = Array.from(c.genome);
  o.memories = c.memories.map((m) => ({ ...m }));
  o.relations = c.relations.map((r) => ({ ...r }));
  o.children = c.children.slice();
  return o;
}

function deserializeCreature(d: Record<string, unknown>): Creature {
  const g = Float32Array.from(d.genome as number[]);
  const c = new Creature(d.id as number, g, d.x as number, d.y as number, d.speciesId as number, d.sex as 0 | 1);
  Object.assign(c, d);
  c.genome = g;
  return c;
}

function kindRank(k: string): number {
  return k === 'mate' ? 6 : k === 'mother' || k === 'father' ? 5 : k === 'child' ? 4 : k === 'sibling' ? 3 : k === 'friend' ? 2 : 1;
}

function personality(c: Creature): { label: string; value: number }[] {
  return [
    { label: 'Boldness', value: c.aggression * 0.6 + c.curiosity * 0.4 },
    { label: 'Sociability', value: c.sociability },
    { label: 'Aggression', value: c.aggression },
    { label: 'Curiosity', value: c.curiosity },
    { label: 'Intellect', value: c.intelligence },
  ];
}

function describeDivergence(a: number[], b: number[]): string {
  const labels: Record<string, [string, string]> = {
    size: ['larger', 'smaller'], speed: ['faster', 'slower'], perception: ['keener-sensed', 'duller-sensed'],
    strength: ['stronger', 'weaker'], intelligence: ['more intelligent', 'simpler'], sociability: ['more social', 'more solitary'],
    aggression: ['more aggressive', 'gentler'], coldTol: ['cold-hardy', 'cold-sensitive'], heatTol: ['heat-hardy', 'heat-sensitive'],
    diet: ['more carnivorous', 'more herbivorous'], swim: ['better swimmers', 'land-bound'], nocturnal: ['more nocturnal', 'more diurnal'],
    fertility: ['more fertile', 'less fertile'], longevity: ['longer-lived', 'shorter-lived'],
  };
  const diffs: [string, number][] = [];
  for (let i = 0; i < 16; i++) {
    const k = GENES[i];
    if (labels[k]) diffs.push([k, b[i] - a[i]]);
  }
  diffs.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const top = diffs.slice(0, 2).filter((d) => Math.abs(d[1]) > 0.05);
  if (top.length === 0) return '';
  return top.map(([k, v]) => labels[k][v > 0 ? 0 : 1]).join(' and ');
}
