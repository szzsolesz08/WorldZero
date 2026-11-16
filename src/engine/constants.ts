/** Central tuning knobs. Balance the ecosystem here. */

export const SAVE_VERSION = 3;

// ---- Time ----
export const TICKS_PER_DAY = 240;
export const DAYS_PER_SEASON = 5;
export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * 4;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
/** Ticks per real second at 1x speed. */
export const BASE_TPS = 30;

// ---- World ----
export const DEFAULT_WIDTH = 256;
export const DEFAULT_HEIGHT = 160;
export const CHUNK = 8; // food-sense chunk size (tiles)
export const VEG_INTERVAL = 10; // ticks between vegetation passes
export const VEG_CAP_SCALE = 10; // max vegetation units on a fertility-1 tile
export const VEG_GROWTH = 0.012; // regrowth rate per vegetation pass
/** Plants can't be grazed below this (roots regrow). */
export const VEG_RESERVE = 0.6;

// ---- Population ----
export const MAX_POPULATION = 3200;
export const DECIDE_INTERVAL = 8;
export const SPATIAL_CELL = 4;

// ---- Energy model ----
export const BASAL_COST = 0.05; // energy per tick for size-1 creature at rest
export const MOVE_COST = 0.045; // extra energy per tick at reference speed 0.1 tiles/tick
export const PLANT_ENERGY = 3.2; // energy per vegetation unit at full herbivore efficiency
export const MEAT_ENERGY = 2.2; // energy per meat unit at full carnivore efficiency
export const BITE = 0.9; // vegetation units eaten per tick (scaled by size)
export const THIRST_RATE = 1 / 420; // hydration lost per tick
export const DRINK_RATE = 0.06;
export const STARVE_DAMAGE = 0.25;
export const DEHYDRATE_DAMAGE = 0.25;
export const REGEN_RATE = 0.03;
export const CARCASS_MEAT_PER_SIZE = 45;
export const CARCASS_DECAY = 0.03;

// ---- Reproduction & genetics ----
export const MATE_MAX_DISTANCE = 0.22; // genetic distance limit for interbreeding
export const DEFAULT_MUTATION_RATE = 0.08;
export const MUTATION_SD = 0.06;
export const MACRO_MUTATION_P = 0.004;
export const MACRO_MUTATION_SD = 0.25;
export const BIRTH_COST_MOTHER = 22;
export const BIRTH_COST_FATHER = 8;

// ---- Speciation ----
export const SPECIATION_INTERVAL = 600;
export const SPECIATION_THRESHOLD = 0.11;
export const ALLOPATRIC_THRESHOLD = 0.03;
export const MIN_SPECIES_SPLIT = 8;

// ---- Civilization ----
export const CIV_INTERVAL = 30;
export const TRIBE_MIN_INT = 0.5;
export const TRIBE_MIN_SOCIAL = 0.4;
export const TRIBE_MIN_FOUNDERS = 4;

// ---- Stats ----
export const STATS_INTERVAL = 120; // ticks between history samples (half a day)
export const HISTORY_MAX = 720;
export const ARCHIVE_MAX = 30000;
