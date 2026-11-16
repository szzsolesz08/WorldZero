import type { FromWorker, ToWorker, TerrainPayload, LayersPayload, FramePayload, StatsPayload } from '../worker/protocol';
import type { ScenarioConfig } from '../engine/scenarios';
import type { SimState } from '../engine/simulation';
import type { CreatureDetail, GodCommand, SimEvent } from '../engine/types';

type Listener<T> = (v: T) => void;

/** Main-thread handle to the simulation worker. Holds the latest frame/terrain/layers for the renderer. */
export class SimClient {
  private worker: Worker;
  terrain: TerrainPayload | null = null;
  layers: LayersPayload | null = null;
  frame: FramePayload | null = null;
  frameTime = 0;
  private reqId = 1;
  private pending = new Map<number, (s: SimState) => void>();
  private listeners: { [K in FromWorker['t']]?: Listener<Extract<FromWorker, { t: K }>>[] } = {};

  constructor() {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      console.error('Simulation worker error', e);
      this.emit({ t: 'error', message: e.message || 'Simulation worker crashed' });
    };
  }

  private handle(m: FromWorker): void {
    switch (m.t) {
      case 'terrain': this.terrain = m.terrain; break;
      case 'layers': this.layers = m.layers; break;
      case 'frame': this.frame = m.frame; this.frameTime = performance.now(); break;
      case 'saved': {
        const cb = this.pending.get(m.reqId);
        this.pending.delete(m.reqId);
        cb?.(m.state);
        break;
      }
    }
    this.emit(m);
  }

  private emit(m: FromWorker): void {
    const ls = this.listeners[m.t] as Listener<FromWorker>[] | undefined;
    if (ls) for (const l of ls) l(m);
  }

  on<K extends FromWorker['t']>(t: K, fn: Listener<Extract<FromWorker, { t: K }>>): () => void {
    const arr = (this.listeners[t] ??= []) as Listener<Extract<FromWorker, { t: K }>>[];
    arr.push(fn);
    return () => {
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  newWorld(scenario: ScenarioConfig, seed: string): void {
    this.terrain = null;
    this.layers = null;
    this.frame = null;
    this.send({ t: 'new', scenario, seed });
  }

  load(state: SimState, awayMs = 0): void {
    this.terrain = null;
    this.layers = null;
    this.frame = null;
    this.send({ t: 'load', state, awayMs });
  }

  setSpeed(tps: number, paused: boolean): void {
    this.send({ t: 'speed', tps, paused });
  }

  command(cmd: GodCommand): void {
    this.send({ t: 'cmd', cmd });
  }

  select(id: number | null): void {
    this.send({ t: 'select', id });
  }

  selectSettlement(id: number | null): void {
    this.send({ t: 'selectSettlement', id });
  }

  save(): Promise<SimState> {
    const id = this.reqId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: 'save', reqId: id });
    });
  }
}

export type { StatsPayload, CreatureDetail, SimEvent };
