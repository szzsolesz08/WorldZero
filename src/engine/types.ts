/** Shared plain-data types used by engine, worker and UI. */

export type Action =
  | 'wander' | 'graze' | 'hunt' | 'scavenge' | 'drink' | 'flee' | 'mate' | 'rest' | 'socialize'
  | 'explore' | 'follow' | 'defend' | 'work' | 'eat_store' | 'return';

export type Job = 'forage' | 'hunt' | 'woodcut' | 'mine' | 'farm' | 'build' | 'guard' | 'raid' | 'trade' | 'scout';

export interface Memory {
  tick: number;
  kind: string;
  text: string;
}

export type RelationKind = 'mother' | 'father' | 'child' | 'mate' | 'sibling' | 'friend' | 'rival';

export interface Relation {
  id: number;
  kind: RelationKind;
  affinity: number;
}

export type EventCategory = 'species' | 'evolution' | 'civ' | 'war' | 'disaster' | 'creature' | 'climate' | 'milestone' | 'god';

export interface SimEvent {
  id: number;
  tick: number;
  cat: EventCategory;
  /** 1 = minor, 2 = notable, 3 = major */
  level: 1 | 2 | 3;
  title: string;
  text: string;
  x?: number;
  y?: number;
  creatureId?: number;
  speciesId?: number;
  tribeId?: number;
  settlementId?: number;
}

export type SimParamKey = 'tempOffset' | 'rainMult' | 'foodMult' | 'mutationRate' | 'disasterRate';

export type GodCommand =
  | { type: 'spawn'; x: number; y: number; count: number; speciesId?: number; template?: string }
  | { type: 'smite'; x: number; y: number; radius: number }
  | { type: 'food'; x: number; y: number; radius: number; amount: number }
  | { type: 'weather'; x: number; y: number; kind: 'rain' | 'storm' | 'snow' }
  | { type: 'clearWeather' }
  | { type: 'drought'; days: number }
  | { type: 'globalStorm' }
  | { type: 'earthquake'; x: number; y: number; magnitude: number }
  | { type: 'meteor'; x: number; y: number }
  | { type: 'volcano'; x: number; y: number }
  | { type: 'wildfire'; x: number; y: number }
  | { type: 'plague'; x: number; y: number }
  | { type: 'terraform'; x: number; y: number; radius: number; delta: number }
  | { type: 'setParam'; key: SimParamKey; value: number }
  | { type: 'introduceSpecies'; template: string; count: number; x?: number; y?: number }
  | { type: 'cull'; percent: number }
  | { type: 'addRandom'; count: number }
  | { type: 'climateShift'; trend: number; limit: number }
  | { type: 'bless'; creatureId: number }
  | { type: 'iceAge' };

export interface SimSettings {
  foodMult: number;
  mutationRate: number;
  disasterRate: number;
  /** Per-year increase of disasterRate (Apocalypse). */
  disasterRamp: number;
}

// ---------- Views sent to the UI ----------

export interface SpeciesView {
  id: number;
  name: string;
  common: string;
  parentId: number;
  originTick: number;
  extinctTick: number | null;
  origin: string;
  color: string;
  hue: number;
  population: number;
  peak: number;
  totalBorn: number;
  diet: 'herbivore' | 'omnivore' | 'carnivore';
  sapient: boolean;
  traits: Record<string, number>;
  generationMax: number;
  landmasses: number;
}

export interface TribeView {
  id: number;
  name: string;
  speciesId: number;
  color: string;
  hue: number;
  founded: number;
  population: number;
  peak: number;
  settlements: number;
  territory: number;
  techs: string[];
  researching: string | null;
  researchProgress: number;
  stock: { food: number; wood: number; stone: number; ore: number };
  culture: { militarism: number; openness: number; scholarship: number; agrarian: number };
  archetype: string;
  government: string;
  traditions: string[];
  leaderId: number;
  leaderName: string;
  collapsed: boolean;
  collapsedTick: number | null;
  relations: { tribeId: number; value: number; status: 'peace' | 'alliance' | 'war' }[];
  homeX: number;
  homeY: number;
  history: number[];
}

export interface SettlementView {
  id: number;
  tribeId: number;
  name: string;
  x: number;
  y: number;
  tier: number;
  health: number;
  population: number;
  hue: number;
  founded: number;
  destroyed: boolean;
  walls: boolean;
  farms: number;
}

export interface WeatherView {
  id: number;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  kind: 'rain' | 'storm' | 'snow';
}

export interface EnvironmentView {
  tick: number;
  year: number;
  season: number;
  day: number;
  dayPhase: number;
  daylight: number;
  globalTemp: number;
  avgTemp: number;
  rainfall: number;
  tempOffset: number;
  drift: number;
  rainMult: number;
  foodMult: number;
  mutationRate: number;
  disasterRate: number;
  droughtDays: number;
  vegetation: number;
  burning: number;
  ecoHealth: number;
}

export interface StatsSummary {
  population: number;
  speciesAlive: number;
  speciesTotal: number;
  births: number;
  deaths: number;
  totalBirths: number;
  totalDeaths: number;
  avgLifespanDays: number;
  avgIntelligence: number;
  biodiversity: number;
  geneticDiversity: number;
  mutationsPerBirth: number;
  tribes: number;
  settlements: number;
  maxGeneration: number;
  herbivores: number;
  omnivores: number;
  carnivores: number;
  infected: number;
}

export interface HistorySeries {
  tick: number[];
  [key: string]: number[];
}

export interface CreatureDetail {
  id: number;
  alive: boolean;
  name: string;
  speciesId: number;
  speciesName: string;
  speciesCommon: string;
  sex: 'female' | 'male';
  generation: number;
  x: number;
  y: number;
  biome: string;
  landmass: string;
  ageDays: number;
  lifespanDays: number;
  maturityDays: number;
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  hydration: number;
  temperature: number;
  comfortLow: number;
  comfortHigh: number;
  action: string;
  goal: string;
  genes: Record<string, number>;
  personality: { label: string; value: number }[];
  hue: number;
  saturation: number;
  pattern: number;
  shape: number;
  size: number;
  diet: number;
  tribe: { id: number; name: string } | null;
  home: { id: number; name: string } | null;
  job: string | null;
  title: string;
  kills: number;
  children: number;
  distance: number;
  maxTravel: number;
  infected: boolean;
  memories: Memory[];
  relations: { id: number; name: string; kind: string; affinity: number; alive: boolean }[];
  family: FamilyNode;
  causeOfDeath: string | null;
  birthTick: number;
  deathTick: number | null;
}

export interface FamilyNode {
  id: number;
  name: string;
  alive: boolean;
  speciesId: number;
  hue: number;
  parents: FamilyNode[];
  children: FamilyNode[];
}

export interface ArchivedCreature {
  id: number;
  name: string;
  speciesId: number;
  generation: number;
  sex: number;
  motherId: number;
  fatherId: number;
  children: number[];
  birthTick: number;
  deathTick: number;
  cause: string;
  hue: number;
  kills: number;
  title: string;
  memories: Memory[];
  genome: number[];
  tribeId: number;
  x: number;
  y: number;
  maxTravel: number;
  distance: number;
}
