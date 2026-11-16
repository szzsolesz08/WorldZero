import { SimClient } from '../client/simClient';
import { useUI } from '../client/store';
import { BASE_TPS } from '../engine/constants';
import { writeAutosave } from '../client/persistence';

let client: SimClient | null = null;

/** Singleton simulation client wired into the UI store. */
export function getClient(): SimClient {
  if (client) return client;
  const c = new SimClient();
  client = c;
  const st = () => useUI.getState();
  c.on('ready', (m) => {
    st().set({ ready: true, loading: null, seed: m.seed, scenario: m.scenario, scenarioName: m.scenario.name, events: [], selectedCreature: null, creature: null, follow: false, selectedTribe: null });
    applySpeed();
  });
  c.on('progress', (m) => st().set({ loading: { label: m.label, progress: m.total > 0 ? m.done / m.total : 0 } }));
  let lastEnvPush = 0;
  c.on('frame', (m) => {
    // The renderer reads frames directly; the React store only needs ~5 updates per second.
    const now = performance.now();
    if (now - lastEnvPush < 200 && st().env) return;
    lastEnvPush = now;
    st().set({ env: m.frame.env, measuredTps: m.frame.tps, msPerTick: m.frame.msPerTick });
  });
  c.on('stats', (m) => {
    const s = m.stats;
    st().set({
      summary: s.summary, history: s.history, speciesHistory: s.speciesHistory, species: s.species, tribes: s.tribes,
      deathCauses: s.deathCauses, scenarioName: s.scenarioName, seed: s.seed,
    });
    st().pushEvents(s.events);
  });
  c.on('creature', (m) => {
    const s = st();
    if (m.detail && m.detail.id === s.selectedCreature) {
      s.set({ creature: m.detail });
      if (!m.detail.alive && s.follow) s.set({ follow: false });
    } else if (!m.detail && s.selectedCreature !== null) {
      s.set({ creature: null });
    }
  });
  c.on('away', (m) => st().set({ away: { ticks: m.ticks, events: m.events, popBefore: m.popBefore, popAfter: m.popAfter }, loading: null }));
  c.on('error', (m) => {
    console.error(m.message);
    st().set({ error: m.message, loading: null });
  });
  return c;
}

export function applySpeed(): void {
  const s = useUI.getState();
  getClient().setSpeed(BASE_TPS * s.speed, s.paused);
}

export async function autosaveNow(): Promise<void> {
  const c = getClient();
  const s = useUI.getState();
  if (!s.ready || s.loading) return;
  const state = await c.save();
  await writeAutosave(state, state.creatures.length);
  useUI.getState().set({ lastSavedAt: Date.now() });
}
