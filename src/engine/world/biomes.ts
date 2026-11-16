export const Biome = {
  DeepOcean: 0,
  Ocean: 1,
  Shallows: 2,
  Lake: 3,
  Beach: 4,
  Desert: 5,
  Savanna: 6,
  Grassland: 7,
  Shrubland: 8,
  Forest: 9,
  Rainforest: 10,
  Swamp: 11,
  Taiga: 12,
  Tundra: 13,
  Glacier: 14,
  Mountain: 15,
  SnowPeak: 16,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export interface BiomeInfo {
  name: string;
  color: [number, number, number];
  /** Vegetation capacity multiplier, 0..1.2 */
  fertility: number;
  /** Movement speed multiplier (1 = open ground). */
  moveMult: number;
  water: boolean;
  fresh: boolean;
  /** Shelter from storms/predators 0..1 */
  shelter: number;
  wood: number;
  stone: number;
}

export const BIOMES: BiomeInfo[] = [
  { name: 'Deep Ocean', color: [10, 30, 62], fertility: 0, moveMult: 0.5, water: true, fresh: false, shelter: 0, wood: 0, stone: 0 },
  { name: 'Ocean', color: [18, 52, 92], fertility: 0, moveMult: 0.55, water: true, fresh: false, shelter: 0, wood: 0, stone: 0 },
  { name: 'Shallows', color: [34, 92, 122], fertility: 0, moveMult: 0.6, water: true, fresh: false, shelter: 0, wood: 0, stone: 0 },
  { name: 'Lake', color: [40, 98, 130], fertility: 0, moveMult: 0.6, water: true, fresh: true, shelter: 0, wood: 0, stone: 0 },
  { name: 'Beach', color: [206, 190, 140], fertility: 0.12, moveMult: 0.95, water: false, fresh: false, shelter: 0, wood: 0, stone: 0.1 },
  { name: 'Desert', color: [208, 178, 118], fertility: 0.08, moveMult: 0.85, water: false, fresh: false, shelter: 0, wood: 0, stone: 0.3 },
  { name: 'Savanna', color: [170, 166, 84], fertility: 0.55, moveMult: 1, water: false, fresh: false, shelter: 0.1, wood: 0.15, stone: 0.1 },
  { name: 'Grassland', color: [110, 156, 70], fertility: 0.85, moveMult: 1, water: false, fresh: false, shelter: 0.05, wood: 0.05, stone: 0.05 },
  { name: 'Shrubland', color: [128, 138, 78], fertility: 0.5, moveMult: 0.9, water: false, fresh: false, shelter: 0.2, wood: 0.25, stone: 0.15 },
  { name: 'Forest', color: [52, 112, 54], fertility: 0.95, moveMult: 0.75, water: false, fresh: false, shelter: 0.6, wood: 1, stone: 0.05 },
  { name: 'Rainforest', color: [28, 96, 48], fertility: 1.15, moveMult: 0.6, water: false, fresh: false, shelter: 0.7, wood: 1, stone: 0 },
  { name: 'Swamp', color: [66, 96, 70], fertility: 0.7, moveMult: 0.55, water: false, fresh: true, shelter: 0.3, wood: 0.4, stone: 0 },
  { name: 'Taiga', color: [56, 92, 74], fertility: 0.55, moveMult: 0.75, water: false, fresh: false, shelter: 0.55, wood: 0.9, stone: 0.1 },
  { name: 'Tundra', color: [140, 148, 128], fertility: 0.22, moveMult: 0.9, water: false, fresh: false, shelter: 0, wood: 0, stone: 0.2 },
  { name: 'Glacier', color: [220, 232, 240], fertility: 0, moveMult: 0.6, water: false, fresh: false, shelter: 0, wood: 0, stone: 0.1 },
  { name: 'Mountain', color: [116, 108, 100], fertility: 0.12, moveMult: 0.45, water: false, fresh: false, shelter: 0.4, wood: 0.05, stone: 1 },
  { name: 'Snow Peak', color: [236, 240, 246], fertility: 0, moveMult: 0.35, water: false, fresh: false, shelter: 0.2, wood: 0, stone: 0.8 },
];

export function isWaterBiome(b: number): boolean {
  return b <= Biome.Lake;
}
