/// <reference lib="webworker" />
import { Simulation, FRAME_STRIDE } from '../engine/simulation';
import { BASE_TPS, TICKS_PER_DAY, VEG_CAP_SCALE } from '../engine/constants';
import type { FromWorker, ToWorker, TerrainPayload } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let sim: Simulation | null = null;
let tps = BASE_TPS;
let paused = false;
let acc = 0;
let last = performance.now();
let lastFrame = 0, lastLayers = 0, lastStats = 0, lastDetail = 0;
let lastEventId = 0;
let selected: number | null = null;
let sentTerrainVersion = -1;
let ticksWindow = 0, windowStart = performance.now(), measuredTps = 0;
let busy = false; // catching up
let scheduled = false;
const MAX_CATCHUP = TICKS_PER_DAY * 24;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function terrainPayload(s: Simulation, dirty: TerrainPayload['dirty']): TerrainPayload {
  const w = s.world;
  return {
    width: w.width, height: w.height, seaLevel: w.seaLevel,
    elevation: w.elevation.slice(), moisture: w.moisture.slice(), baseTemp: w.baseTemp.slice(),
    biome: w.biome.slice(), river: w.river.slice(), lake: w.lake.slice(),
    landmasses: w.landmasses.map((l) => ({ ...l })), version: w.terrainVersion, dirty,
  };
}

function sendTerrain(): void {
  if (!sim) return;
  const p = terrainPayload(sim, null);
  sentTerrainVersion = sim.world.terrainVersion;
  post({ t: 'terrain', terrain: p }, [p.elevation.buffer, p.moisture.buffer, p.baseTemp.buffer, p.biome.buffer, p.river.buffer, p.lake.buffer]);
}

function sendLayers(): void {
  if (!sim) return;
  const w = sim.world;
  const veg = new Uint8Array(w.size);
  const fm = sim.settings.foodMult;
  for (let i = 0; i < w.size; i++) {
    const cap = w.fertility[i] * VEG_CAP_SCALE * fm;
    veg[i] = cap > 0.05 ? Math.min(255, Math.round((w.veg[i] / cap) * 200)) : 0;
  }
  const tribeHues: Record<number, number> = {};
  for (const t of sim.civ.tribes) if (!t.collapsed) tribeHues[t.id] = t.hue;
  const territory = w.territory.slice(), fire = w.fire.slice(), farm = w.farm.slice();
  post({ t: 'layers', layers: { veg, territory, fire, farm, tribeHues } }, [veg.buffer, territory.buffer, fire.buffer, farm.buffer]);
}

function sendFrame(now: number): void {
  if (!sim) return;
  const buf = new Float32Array(Math.max(1, sim.creatures.length) * FRAME_STRIDE);
  const count = sim.packFrame(buf);
  const settlements = sim.civ.settlements
    .filter((s) => !s.destroyed || sim!.tick - s.destroyedTick < TICKS_PER_DAY * 6)
    .map((s) => sim!.civ.settlementView(s));
  const weather = sim.climate.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, radius: c.radius, intensity: c.intensity, kind: c.kind }));
  const carcasses: number[] = [];
  for (const k of sim.carcasses) carcasses.push(k.x, k.y, k.meat);
  const fx = sim.fx.splice(0);
  post({
    t: 'frame',
    frame: { tick: sim.tick, count, buf, settlements, weather, carcasses, fx, env: sim.environment(), tps: measuredTps, paused },
  }, [buf.buffer]);
  lastFrame = now;
}

function sendStats(): void {
  if (!sim) return;
  const events = sim.events.since(lastEventId);
  if (events.length) lastEventId = events[events.length - 1].id;
  post({
    t: 'stats',
    stats: {
      summary: sim.summary(),
      history: sim.stats.history as never,
      speciesHistory: sim.stats.speciesHistory,
      species: sim.species.list.map((s) => sim!.species.view(s)),
      tribes: sim.civ.tribes.map((t) => sim!.civ.tribeView(sim!, t)),
      events,
      deathCauses: sim.deathCauses,
      scenarioName: sim.scenario.name,
      seed: sim.seed,
    },
  });
}

function sendDetail(): void {
  if (!sim || selected === null) return;
  post({ t: 'creature', detail: sim.creatureDetail(selected) });
}

function schedule(delay: number): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(loop, delay);
}

function loop(): void {
  scheduled = false;
  const now = performance.now();
  const dt = Math.min(250, now - last);
  last = now;
  if (sim && !busy) {
    if (!paused) {
      acc += (dt / 1000) * tps;
      const maxBacklog = Math.max(2, tps * 0.2);
      if (acc > maxBacklog) acc = maxBacklog;
      const start = performance.now();
      while (acc >= 1 && performance.now() - start < 14) {
        sim.step();
        acc -= 1;
        ticksWindow++;
      }
    }
    if (now - windowStart >= 1000) {
      measuredTps = (ticksWindow * 1000) / (now - windowStart);
      ticksWindow = 0;
      windowStart = now;
    }
    if (sim.world.terrainVersion !== sentTerrainVersion) sendTerrain();
    if (now - lastFrame >= 24) sendFrame(now);
    if (now - lastLayers >= 450) { sendLayers(); lastLayers = now; }
    if (now - lastStats >= 500) { sendStats(); lastStats = now; }
    if (now - lastDetail >= 250) { sendDetail(); lastDetail = now; }
  }
  schedule(paused ? 30 : acc >= 1 ? 0 : 6);
}

function boot(s: Simulation, resumed: boolean): void {
  sim = s;
  lastEventId = 0;
  sentTerrainVersion = -1;
  acc = 0;
  last = performance.now();
  post({ t: 'ready', seed: s.seed, scenario: s.scenario, resumed });
  sendTerrain();
  sendLayers();
  sendStats();
  sendFrame(performance.now());
}

async function catchUp(ticks: number): Promise<void> {
  if (!sim || ticks <= 0) return;
  busy = true;
  const s = sim;
  const total = Math.min(ticks, MAX_CATCHUP);
  const popBefore = s.creatures.length;
  const startEvent = s.events.nextId;
  let done = 0;
  while (done < total) {
    const start = performance.now();
    while (done < total && performance.now() - start < 40) { s.step(); done++; }
    post({ t: 'progress', done, total, label: 'The world lived on while you were away…' });
    await new Promise((r) => setTimeout(r, 0));
    if (sim !== s) return;
  }
  busy = false;
  const events = s.events.events.filter((e) => e.id >= startEvent && e.level >= 2);
  post({ t: 'away', ticks: total, events, popBefore, popAfter: s.creatures.length });
  sendTerrain();
  sendLayers();
  sendStats();
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.t) {
      case 'new': {
        post({ t: 'progress', done: 0, total: 1, label: 'Forging a new world…' });
        boot(Simulation.create(m.scenario, m.seed), false);
        break;
      }
      case 'load': {
        const s = Simulation.deserialize(m.state);
        boot(s, true);
        const ticks = Math.floor((m.awayMs / 1000) * BASE_TPS);
        if (ticks > TICKS_PER_DAY / 4) void catchUp(ticks);
        break;
      }
      case 'speed':
        tps = m.tps;
        paused = m.paused;
        break;
      case 'cmd':
        sim?.queueCommand(m.cmd);
        if (paused && sim) { sim.step(); sendFrame(performance.now()); sendLayers(); }
        break;
      case 'select':
        selected = m.id;
        sendDetail();
        break;
      case 'save':
        if (sim) post({ t: 'saved', reqId: m.reqId, state: sim.serialize() });
        break;
      case 'step':
        if (sim) for (let i = 0; i < m.ticks; i++) sim.step();
        break;
    }
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  schedule(0);
};

schedule(0);
