import { G, Genome, GENE_COUNT } from './genome';
import { BASAL_COST, TICKS_PER_YEAR } from '../constants';
import type { Action, Job, Memory, Relation, RelationKind } from '../types';

export const MEMORY_CAP = 32;
export const RELATION_CAP = 14;

export class Creature {
  id: number;
  name: string;
  speciesId: number;
  generation: number;
  sex: 0 | 1; // 0 female, 1 male
  genome: Genome;

  // ---- Phenotype (derived from genome) ----
  size = 1;
  speed = 0.1;
  perception = 6;
  strength = 1;
  intelligence = 0.3;
  sociability = 0.5;
  aggression = 0.3;
  curiosity = 0.5;
  litter = 1;
  lifespan = TICKS_PER_YEAR;
  maturity = 600;
  coldTol = 0.5;
  heatTol = 0.5;
  diet = 0.1;
  swim = 0.1;
  immunity = 0.5;
  nocturnal = false;
  comfortLow = 0;
  comfortHigh = 30;
  maxEnergy = 100;
  maxHealth = 100;
  basal = BASAL_COST;
  reproCooldown = 800;
  herbEff = 1;
  meatEff = 0;

  // ---- State ----
  x: number;
  y: number;
  heading = 0;
  energy = 60;
  hydration = 0.9;
  health = 100;
  age = 0;
  alive = true;

  action: Action = 'wander';
  goal = 'Getting bearings';
  tx = 0;
  ty = 0;
  targetId = -1;
  decideIn = 0;
  actionTicks = 0;
  job: Job | null = null;
  carryKind: 'food' | 'wood' | 'stone' | 'ore' | null = null;
  carry = 0;

  cooldown = 0;
  motherId = -1;
  fatherId = -1;
  mateId = -1;
  children: number[] = [];
  tribeId = -1;
  homeId = -1;
  /** Migration group this creature travels with (-1 = none). While travelling, homeId is -1. */
  migrationId = -1;
  lastMigrated = -1e9;

  birthTick = 0;
  birthX = 0;
  birthY = 0;
  maxTravel = 0;
  distance = 0;
  kills = 0;
  flags = 0; // bit 1: journey reported, bit 2: apex reported, bit 4: prolific reported
  title = '';
  lastLandmass = -1;

  memories: Memory[] = [];
  relations: Relation[] = [];

  foodX = -1; foodY = -1;
  waterX = -1; waterY = -1;
  dangerX = -1; dangerY = -1; dangerTick = -99999;

  infection = 0;
  immuneTicks = 0;
  attackCd = 0;
  lastAttacker = -1;
  lastDamage = '';
  tempNow = 15;
  storm = 0;
  shelter = 0;
  stress = 0;
  resting = false;
  sprint = false;
  stamina = 1;

  constructor(id: number, genome: Genome, x: number, y: number, speciesId: number, sex: 0 | 1) {
    this.id = id;
    this.name = '';
    this.genome = genome;
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    this.birthX = x;
    this.birthY = y;
    this.speciesId = speciesId;
    this.generation = 0;
    this.sex = sex;
    derivePhenotype(this);
    this.energy = this.maxEnergy * 0.7;
    this.health = this.maxHealth;
  }

  /** Body size scaled by growth toward adulthood. */
  get effSize(): number {
    const g = this.age >= this.maturity ? 1 : 0.35 + 0.65 * (this.age / this.maturity);
    return this.size * g;
  }

  get mature(): boolean {
    return this.age >= this.maturity;
  }

  remember(tick: number, kind: string, text: string): void {
    this.memories.push({ tick, kind, text });
    if (this.memories.length > MEMORY_CAP) {
      // Keep the birth memory, drop the oldest after it.
      this.memories.splice(1, 1);
    }
  }

  relation(id: number): Relation | undefined {
    for (const r of this.relations) if (r.id === id) return r;
    return undefined;
  }

  addRelation(id: number, kind: RelationKind, affinity: number): Relation {
    const existing = this.relation(id);
    if (existing) {
      const kinRank = (k: RelationKind) => (k === 'mother' || k === 'father' || k === 'child' || k === 'sibling' ? 3 : k === 'mate' ? 2 : 1);
      if (kinRank(kind) > kinRank(existing.kind)) existing.kind = kind;
      existing.affinity = Math.max(-1, Math.min(1, existing.affinity + affinity * 0.3));
      return existing;
    }
    const r: Relation = { id, kind, affinity };
    this.relations.push(r);
    if (this.relations.length > RELATION_CAP) {
      // Evict weakest non-kin bond.
      let wi = -1, wa = Infinity;
      for (let i = 0; i < this.relations.length; i++) {
        const k = this.relations[i].kind;
        if (k === 'friend' || k === 'rival') {
          const a = Math.abs(this.relations[i].affinity);
          if (a < wa) { wa = a; wi = i; }
        }
      }
      if (wi >= 0) this.relations.splice(wi, 1);
      else this.relations.shift();
    }
    return r;
  }
}

/** Translate genes into traits, with explicit costs so selection has something to work on. */
export function derivePhenotype(c: Creature): void {
  const g = c.genome;
  c.size = 0.5 + g[G.size] * 1.5;
  const sizeSlow = 1.12 - 0.16 * (c.size - 0.5);
  c.speed = (0.045 + 0.11 * g[G.speed]) * sizeSlow;
  c.perception = 3 + 11 * g[G.perception];
  c.strength = (0.3 + g[G.strength]) * c.size;
  c.intelligence = g[G.intelligence];
  c.sociability = g[G.sociability];
  c.aggression = g[G.aggression];
  c.curiosity = g[G.curiosity];
  c.litter = 1 + Math.floor(g[G.fertility] * 2.6);
  c.lifespan = Math.round(TICKS_PER_YEAR * (0.7 + 1.5 * g[G.longevity]) * (0.9 + 0.1 * c.size));
  c.maturity = Math.round(c.lifespan * (0.14 + 0.1 * g[G.intelligence]));
  c.coldTol = g[G.coldTol];
  c.heatTol = g[G.heatTol];
  c.diet = g[G.diet];
  c.swim = g[G.swim];
  c.immunity = g[G.immunity];
  c.nocturnal = g[G.nocturnal] > 0.5;
  c.comfortLow = 8 - 30 * c.coldTol;
  c.comfortHigh = 25 + 20 * c.heatTol;
  c.maxEnergy = 100 * c.size;
  c.maxHealth = 60 + 50 * c.size;
  c.basal = BASAL_COST * Math.pow(c.size, 0.75) * (
    1 + 0.28 * g[G.intelligence] + 0.25 * g[G.perception] + 0.15 * g[G.longevity] +
    0.18 * (g[G.coldTol] + g[G.heatTol]) + 0.12 * g[G.immunity] + 0.1 * g[G.swim] + 0.1 * g[G.strength]
  );
  c.reproCooldown = Math.round(TICKS_PER_YEAR * (0.1 + 0.16 * (1 - g[G.fertility])) * (0.75 + 0.25 * c.size));
  // Intelligence pays for itself through better foraging and food processing.
  const smarts = Math.max(0, g[G.intelligence] - 0.35);
  c.herbEff = Math.max(0, Math.min(1, 1.1 - c.diet * 1.3 + smarts * 0.5));
  c.meatEff = Math.max(0, Math.min(1, (c.diet - 0.18) * 1.35 + smarts * 0.4));
}

export function genomeArray(c: Creature): number[] {
  const a = new Array(GENE_COUNT);
  for (let i = 0; i < GENE_COUNT; i++) a[i] = c.genome[i];
  return a;
}
