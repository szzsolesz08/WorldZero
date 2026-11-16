import type { GenomeTemplate } from './creatures/genome';
import type { WorldGenParams } from './world/world';

export interface SpeciesTemplate {
  id: string;
  label: string;
  description: string;
  genes: GenomeTemplate;
}

export const TEMPLATES: Record<string, SpeciesTemplate> = {
  grazer: {
    id: 'grazer', label: 'Grazer', description: 'Social plains herbivore that lives in herds.',
    genes: { size: 0.42, speed: 0.45, perception: 0.45, strength: 0.3, intelligence: 0.18, sociability: 0.72, aggression: 0.15, curiosity: 0.35, fertility: 0.62, longevity: 0.4, coldTol: 0.4, heatTol: 0.45, diet: 0.05, swim: 0.12, immunity: 0.45, nocturnal: 0.15, hue: 0.12, saturation: 0.55, pattern: 0.3, shape: 0.2 },
  },
  browser: {
    id: 'browser', label: 'Browser', description: 'Large, slow forest herbivore with few young.',
    genes: { size: 0.66, speed: 0.32, perception: 0.4, strength: 0.55, intelligence: 0.2, sociability: 0.4, aggression: 0.3, curiosity: 0.3, fertility: 0.42, longevity: 0.62, coldTol: 0.5, heatTol: 0.35, diet: 0.08, swim: 0.2, immunity: 0.55, nocturnal: 0.2, hue: 0.33, saturation: 0.45, pattern: 0.6, shape: 0.35 },
  },
  hopper: {
    id: 'hopper', label: 'Hopper', description: 'Small, fast and very fertile. Lives fast, dies young.',
    genes: { size: 0.18, speed: 0.62, perception: 0.55, strength: 0.15, intelligence: 0.15, sociability: 0.5, aggression: 0.1, curiosity: 0.5, fertility: 0.86, longevity: 0.22, coldTol: 0.45, heatTol: 0.45, diet: 0.12, swim: 0.1, immunity: 0.35, nocturnal: 0.35, hue: 0.55, saturation: 0.5, pattern: 0.15, shape: 0.1 },
  },
  giant: {
    id: 'giant', label: 'Giant', description: 'Huge, strong, long-lived herbivore. Hard to hunt.',
    genes: { size: 0.92, speed: 0.28, perception: 0.4, strength: 0.88, intelligence: 0.25, sociability: 0.55, aggression: 0.45, curiosity: 0.25, fertility: 0.22, longevity: 0.88, coldTol: 0.45, heatTol: 0.5, diet: 0.04, swim: 0.25, immunity: 0.6, nocturnal: 0.1, hue: 0.08, saturation: 0.3, pattern: 0.8, shape: 0.5 },
  },
  pack_hunter: {
    id: 'pack_hunter', label: 'Pack Hunter', description: 'Social carnivore that hunts prey larger than itself.',
    genes: { size: 0.5, speed: 0.62, perception: 0.62, strength: 0.66, intelligence: 0.35, sociability: 0.66, aggression: 0.78, curiosity: 0.45, fertility: 0.42, longevity: 0.5, coldTol: 0.5, heatTol: 0.45, diet: 0.86, swim: 0.15, immunity: 0.5, nocturnal: 0.4, hue: 0.0, saturation: 0.75, pattern: 0.45, shape: 0.85 },
  },
  stalker: {
    id: 'stalker', label: 'Night Stalker', description: 'Solitary nocturnal ambush predator.',
    genes: { size: 0.6, speed: 0.58, perception: 0.72, strength: 0.78, intelligence: 0.3, sociability: 0.12, aggression: 0.85, curiosity: 0.4, fertility: 0.32, longevity: 0.6, coldTol: 0.5, heatTol: 0.5, diet: 0.92, swim: 0.2, immunity: 0.5, nocturnal: 0.85, hue: 0.78, saturation: 0.6, pattern: 0.7, shape: 0.95 },
  },
  scavenger: {
    id: 'scavenger', label: 'Scavenger', description: 'Curious omnivore that eats plants, carrion and small prey.',
    genes: { size: 0.38, speed: 0.5, perception: 0.55, strength: 0.38, intelligence: 0.36, sociability: 0.45, aggression: 0.4, curiosity: 0.62, fertility: 0.56, longevity: 0.45, coldTol: 0.5, heatTol: 0.5, diet: 0.5, swim: 0.2, immunity: 0.6, nocturnal: 0.45, hue: 0.2, saturation: 0.35, pattern: 0.5, shape: 0.6 },
  },
  sapient: {
    id: 'sapient', label: 'Sapient', description: 'Intelligent, social omnivore capable of building societies.',
    genes: { size: 0.48, speed: 0.45, perception: 0.6, strength: 0.45, intelligence: 0.74, sociability: 0.76, aggression: 0.38, curiosity: 0.7, fertility: 0.5, longevity: 0.62, coldTol: 0.45, heatTol: 0.45, diet: 0.32, swim: 0.2, immunity: 0.5, nocturnal: 0.1, hue: 0.6, saturation: 0.65, pattern: 0.2, shape: 0.7 },
  },
  arctic: {
    id: 'arctic', label: 'Frost Grazer', description: 'Thick-furred herbivore built for the cold.',
    genes: { size: 0.58, speed: 0.38, perception: 0.45, strength: 0.5, intelligence: 0.2, sociability: 0.6, aggression: 0.2, curiosity: 0.3, fertility: 0.48, longevity: 0.55, coldTol: 0.88, heatTol: 0.12, diet: 0.06, swim: 0.2, immunity: 0.5, nocturnal: 0.2, hue: 0.58, saturation: 0.15, pattern: 0.1, shape: 0.3 },
  },
  desert: {
    id: 'desert', label: 'Dune Runner', description: 'Heat-adapted herbivore that needs little water.',
    genes: { size: 0.32, speed: 0.58, perception: 0.5, strength: 0.3, intelligence: 0.2, sociability: 0.4, aggression: 0.15, curiosity: 0.45, fertility: 0.58, longevity: 0.4, coldTol: 0.12, heatTol: 0.9, diet: 0.08, swim: 0.05, immunity: 0.45, nocturnal: 0.6, hue: 0.1, saturation: 0.7, pattern: 0.4, shape: 0.2 },
  },
  amphibian: {
    id: 'amphibian', label: 'Shore Wader', description: 'Omnivorous swimmer that can cross lakes and straits.',
    genes: { size: 0.35, speed: 0.45, perception: 0.5, strength: 0.32, intelligence: 0.25, sociability: 0.5, aggression: 0.25, curiosity: 0.55, fertility: 0.6, longevity: 0.42, coldTol: 0.4, heatTol: 0.55, diet: 0.3, swim: 0.82, immunity: 0.5, nocturnal: 0.3, hue: 0.45, saturation: 0.6, pattern: 0.55, shape: 0.15 },
  },
};

export interface ScenarioSpecies {
  template: string;
  count: number;
  herds?: number;
  genes?: GenomeTemplate;
}

export interface ScenarioSettings {
  foodMult: number;
  rainMult: number;
  tempOffset: number;
  mutationRate: number;
  disasterRate: number;
  disasterRamp: number;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  tagline: string;
  description: string;
  world: Partial<WorldGenParams>;
  species: ScenarioSpecies[];
  settings: ScenarioSettings;
  climate?: { tempTrend?: number; trendLimit?: number; storminess?: number };
  /** Seed every species onto every major island (Island Experiment). */
  perIsland?: boolean;
  custom?: boolean;
  seed?: string;
}

const BASE_SETTINGS: ScenarioSettings = { foodMult: 1, rainMult: 1, tempOffset: 0, mutationRate: 0.08, disasterRate: 0.5, disasterRamp: 0 };

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'primordial', name: 'Primordial World', tagline: 'A balanced, untouched world',
    description: 'A temperate planet seeded with grazers, browsers, scavengers, predators and one sapient species. Watch what emerges.',
    world: {},
    species: [
      { template: 'grazer', count: 150, herds: 6 }, { template: 'browser', count: 70, herds: 4 }, { template: 'hopper', count: 110, herds: 5 },
      { template: 'scavenger', count: 60, herds: 4 }, { template: 'pack_hunter', count: 22, herds: 3 }, { template: 'sapient', count: 40, herds: 3 },
    ],
    settings: { ...BASE_SETTINGS },
  },
  {
    id: 'eden', name: 'Garden of Eden', tagline: 'Abundance and peace',
    description: 'A lush, warm world overflowing with food and almost no predators. How far can life spread when nothing holds it back?',
    world: { moistureBias: 0.12 },
    species: [
      { template: 'grazer', count: 120, herds: 5 }, { template: 'browser', count: 80, herds: 4 }, { template: 'hopper', count: 80, herds: 4 },
      { template: 'giant', count: 30, herds: 2 }, { template: 'scavenger', count: 40, herds: 3 }, { template: 'sapient', count: 30, herds: 2 },
    ],
    settings: { ...BASE_SETTINGS, foodMult: 1.6, rainMult: 1.3, tempOffset: 2, disasterRate: 0 },
  },
  {
    id: 'survival', name: 'Survival', tagline: 'Scarcity and harsh conditions',
    description: 'A dry world with little food. Only the most efficient will survive — watch metabolism, size and heat tolerance adapt.',
    world: { moistureBias: -0.16, temperatureBias: 3 },
    species: [
      { template: 'grazer', count: 120, herds: 6 }, { template: 'hopper', count: 90, herds: 5 }, { template: 'desert', count: 60, herds: 3 },
      { template: 'pack_hunter', count: 16, herds: 2 }, { template: 'stalker', count: 8, herds: 2 },
    ],
    settings: { ...BASE_SETTINGS, foodMult: 0.65, rainMult: 0.65, disasterRate: 1.2 },
  },
  {
    id: 'iceage', name: 'Ice Age', tagline: 'The world slowly freezes',
    description: 'Temperatures fall year after year and glaciers advance. Cold tolerance becomes the key to survival.',
    world: {},
    species: [
      { template: 'grazer', count: 130, herds: 6 }, { template: 'arctic', count: 60, herds: 3 }, { template: 'browser', count: 60, herds: 3 },
      { template: 'scavenger', count: 50, herds: 3 }, { template: 'pack_hunter', count: 16, herds: 2 }, { template: 'sapient', count: 30, herds: 2 },
    ],
    settings: { ...BASE_SETTINGS, tempOffset: 1 },
    climate: { tempTrend: -4, trendLimit: -16 },
  },
  {
    id: 'predators', name: 'Predator Paradise', tagline: 'Fangs everywhere',
    description: 'Packs of hunters and nocturnal stalkers dominate. Prey must evolve speed, vigilance or strength — or vanish.',
    world: {},
    species: [
      { template: 'grazer', count: 200, herds: 8 }, { template: 'hopper', count: 140, herds: 6 }, { template: 'browser', count: 70, herds: 4 },
      { template: 'pack_hunter', count: 48, herds: 6 }, { template: 'stalker', count: 24, herds: 5 },
    ],
    settings: { ...BASE_SETTINGS, foodMult: 1.25 },
  },
  {
    id: 'islands', name: 'Island Experiment', tagline: 'Isolation breeds new species',
    description: 'One ancestral population is placed on every island of an archipelago. Separated by the sea, each lineage evolves on its own.',
    world: { islands: 6, landFraction: 0.3, temperatureBias: 6 },
    species: [{ template: 'grazer', count: 34, herds: 1 }, { template: 'scavenger', count: 14, herds: 1 }],
    settings: { ...BASE_SETTINGS, mutationRate: 0.11, disasterRate: 0.3 },
    perIsland: true,
  },
  {
    id: 'civilization', name: 'Civilization', tagline: 'The dawn of societies',
    description: 'Several intelligent, social species share a fertile world. Tribes, villages, technology, trade and war will follow.',
    world: { moistureBias: 0.05 },
    species: [
      { template: 'sapient', count: 90, herds: 6, genes: { intelligence: 0.78 } },
      { template: 'sapient', count: 50, herds: 3, genes: { intelligence: 0.72, aggression: 0.62, hue: 0.02, size: 0.58 } },
      { template: 'grazer', count: 150, herds: 6 }, { template: 'hopper', count: 100, herds: 5 }, { template: 'browser', count: 50, herds: 3 },
      { template: 'pack_hunter', count: 12, herds: 2 },
    ],
    settings: { ...BASE_SETTINGS, foodMult: 1.2, disasterRate: 0.3 },
  },
  {
    id: 'apocalypse', name: 'Apocalypse', tagline: 'Everything goes wrong',
    description: 'The climate heats relentlessly while earthquakes, meteors, plagues and storms grow ever more frequent.',
    world: {},
    species: [
      { template: 'grazer', count: 140, herds: 6 }, { template: 'hopper', count: 100, herds: 5 }, { template: 'scavenger', count: 60, herds: 4 },
      { template: 'sapient', count: 40, herds: 3 }, { template: 'pack_hunter', count: 20, herds: 3 },
    ],
    settings: { ...BASE_SETTINGS, disasterRate: 2, disasterRamp: 1.5 },
    climate: { tempTrend: 2.5, trendLimit: 12, storminess: 1.8 },
  },
];

export function getScenario(id: string): ScenarioConfig | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
