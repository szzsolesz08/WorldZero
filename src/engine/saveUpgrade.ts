/**
 * Save-format upgrades. Older worlds are converted in place instead of being discarded.
 *  v3 -> v4: settlement lifecycle/economy/history, settlement-level stores, migration groups,
 *            tribe strategy fields, objectives.
 */
import { SAVE_VERSION, MIN_SAVE_VERSION } from './constants';
import { upgradeV3Settlement } from './civ/settlements';
import { defaultPolicies } from './civ/strategy';
import { emptyCounters } from './civ/civilization';
import type { SimState } from './simulation';

const TRIBE_DEFAULTS = {
  leaderSince: 0, capitalId: -1, stability: 0.7, lowStabilitySince: -1, instability: '', instabilityCause: -1, goals: [],
  pendingPolicies: [], policyHistory: [], parentTribeId: -1, successors: [], lastSecession: -1e9, lastExpansion: -1e9,
  lastGoalEvent: -1e9, capitalLostTick: -1e9, popAtCapitalLoss: 0, recentLossTick: -1e9, declining: false, declinePeak: 0,
  lowPoint: 0, migIn: 0, migOut: 0, foodSecurity: 0.6, military: 0, economy: 'Stable', events: [],
};

export function upgradeState(s: SimState): SimState {
  if (!s || typeof s.version !== 'number') throw new Error('Not a WORLD ZERO save.');
  if (s.version === SAVE_VERSION) return s;
  if (s.version < MIN_SAVE_VERSION || s.version > SAVE_VERSION) {
    throw new Error(`Incompatible save (version ${s.version}; this build reads versions ${MIN_SAVE_VERSION}–${SAVE_VERSION}).`);
  }
  if (s.version === 3) upgrade3to4(s);
  return s;
}

function upgrade3to4(s: SimState): void {
  const civ = s.civ as unknown as Record<string, any>;
  const tribes = civ.tribes as Record<string, any>[];
  const tribeName = new Map(tribes.map((t) => [t.id as number, t.name as string]));
  civ.settlements = (civ.settlements as Record<string, unknown>[]).map((d) => upgradeV3Settlement(d, s.tick, tribeName.get(d.tribeId as number) ?? '—'));
  for (const t of tribes) {
    for (const [k, v] of Object.entries(TRIBE_DEFAULTS)) if (t[k] === undefined) t[k] = JSON.parse(JSON.stringify(v));
    if (!t.policies) t.policies = defaultPolicies();
    // Tribe-wide stores move into its settlements, shared out evenly.
    const owned = civ.settlements.filter((x: any) => x.tribeId === t.id && !x.destroyed);
    if (t.stock && owned.length) {
      for (const k of ['food', 'wood', 'stone', 'ore']) for (const st of owned) st.stock[k] += (t.stock[k] ?? 0) / owned.length;
    }
    delete t.stock;
    if (t.capitalId < 0 && owned.length) t.capitalId = owned[0].id;
  }
  civ.groups = [];
  civ.nextGroupId = 1;
  civ.counters = emptyCounters();
  civ.lastLossEvent = [];
  civ.borderReported = [];
  for (const c of s.creatures) { c.migrationId = -1; c.lastMigrated = -1e9; }
  s.objectives = [];
  s.version = 4;
}
