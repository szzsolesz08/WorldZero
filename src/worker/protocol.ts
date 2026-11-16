import type { ScenarioConfig } from '../engine/scenarios';
import type { SimState, Fx } from '../engine/simulation';
import type {
  CreatureDetail, EnvironmentView, GodCommand, HistorySeries, SettlementView, SimEvent, SpeciesView, StatsSummary,
  TribeView, WeatherView,
} from '../engine/types';
import type { Landmass } from '../engine/world/world';

export interface TerrainPayload {
  width: number;
  height: number;
  seaLevel: number;
  elevation: Float32Array;
  moisture: Float32Array;
  baseTemp: Float32Array;
  biome: Uint8Array;
  river: Uint8Array;
  lake: Uint8Array;
  landmasses: Landmass[];
  version: number;
  /** Tile rectangle that changed, or null for everything. */
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface LayersPayload {
  /** Vegetation relative to tile capacity, 0..255 */
  veg: Uint8Array;
  territory: Int16Array;
  fire: Uint8Array;
  farm: Uint8Array;
  tribeHues: Record<number, number>;
}

export interface FramePayload {
  tick: number;
  count: number;
  buf: Float32Array;
  settlements: SettlementView[];
  weather: WeatherView[];
  carcasses: number[];
  fx: Fx[];
  env: EnvironmentView;
  tps: number;
  paused: boolean;
}

export interface StatsPayload {
  summary: StatsSummary;
  history: HistorySeries;
  speciesHistory: Record<number, number[]>;
  species: SpeciesView[];
  tribes: TribeView[];
  events: SimEvent[];
  deathCauses: Record<string, number>;
  scenarioName: string;
  seed: string;
}

export type ToWorker =
  | { t: 'new'; scenario: ScenarioConfig; seed: string }
  | { t: 'load'; state: SimState; awayMs: number }
  | { t: 'speed'; tps: number; paused: boolean }
  | { t: 'cmd'; cmd: GodCommand }
  | { t: 'select'; id: number | null }
  | { t: 'save'; reqId: number }
  | { t: 'step'; ticks: number };

export type FromWorker =
  | { t: 'ready'; seed: string; scenario: ScenarioConfig; resumed: boolean }
  | { t: 'terrain'; terrain: TerrainPayload }
  | { t: 'layers'; layers: LayersPayload }
  | { t: 'frame'; frame: FramePayload }
  | { t: 'stats'; stats: StatsPayload }
  | { t: 'creature'; detail: CreatureDetail | null }
  | { t: 'saved'; reqId: number; state: SimState }
  | { t: 'progress'; done: number; total: number; label: string }
  | { t: 'away'; ticks: number; events: SimEvent[]; popBefore: number; popAfter: number }
  | { t: 'error'; message: string };
