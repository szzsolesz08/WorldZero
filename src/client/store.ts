import { create } from 'zustand';
import type {
  CreatureDetail, EnvironmentView, HistorySeries, SimEvent, SpeciesView, StatsSummary, TribeView,
} from '../engine/types';
import type { ScenarioConfig } from '../engine/scenarios';

export type ToolId =
  | 'inspect' | 'spawn' | 'smite' | 'food' | 'blight' | 'rain' | 'storm' | 'snow' | 'earthquake' | 'meteor'
  | 'volcano' | 'wildfire' | 'plague' | 'raise' | 'lower';

export type PanelId = 'overview' | 'evolution' | 'civ' | 'environment' | 'chronicle';

export const SPEEDS = [1, 2, 10, 100] as const;

export interface AwaySummary {
  ticks: number;
  events: SimEvent[];
  popBefore: number;
  popAfter: number;
}

interface UIState {
  ready: boolean;
  loading: { label: string; progress: number } | null;
  error: string | null;
  seed: string;
  scenario: ScenarioConfig | null;
  scenarioName: string;
  env: EnvironmentView | null;
  measuredTps: number;
  summary: StatsSummary | null;
  history: HistorySeries | null;
  speciesHistory: Record<number, number[]>;
  species: SpeciesView[];
  tribes: TribeView[];
  events: SimEvent[];
  deathCauses: Record<string, number>;
  speed: (typeof SPEEDS)[number];
  paused: boolean;
  tool: ToolId;
  spawnTemplate: string;
  spawnSpeciesId: number | null;
  selectedCreature: number | null;
  creature: CreatureDetail | null;
  follow: boolean;
  selectedTribe: number | null;
  panel: PanelId;
  panelOpen: boolean;
  overlays: { territory: boolean; vegetation: boolean; weather: boolean; labels: boolean };
  away: AwaySummary | null;
  scenarioDialog: boolean;
  lastSavedAt: number | null;
  toast: { id: number; text: string } | null;
  set: (p: Partial<UIState>) => void;
  pushEvents: (evs: SimEvent[]) => void;
  notify: (text: string) => void;
}

let toastId = 1;

export const useUI = create<UIState>((set, get) => ({
  ready: false,
  loading: { label: 'Booting simulation…', progress: 0 },
  error: null,
  seed: '',
  scenario: null,
  scenarioName: '',
  env: null,
  measuredTps: 0,
  summary: null,
  history: null,
  speciesHistory: {},
  species: [],
  tribes: [],
  events: [],
  deathCauses: {},
  speed: 1,
  paused: false,
  tool: 'inspect',
  spawnTemplate: 'grazer',
  spawnSpeciesId: null,
  selectedCreature: null,
  creature: null,
  follow: false,
  selectedTribe: null,
  panel: 'overview',
  panelOpen: true,
  overlays: { territory: true, vegetation: true, weather: true, labels: true },
  away: null,
  scenarioDialog: false,
  lastSavedAt: null,
  toast: null,
  set: (p) => set(p),
  pushEvents: (evs) => {
    if (evs.length === 0) return;
    const merged = get().events.concat(evs);
    set({ events: merged.length > 600 ? merged.slice(merged.length - 600) : merged });
  },
  notify: (text) => set({ toast: { id: toastId++, text } }),
}));
