import type { Simulation } from './simulation';
import { FUNCTIONAL_GENES, G } from './creatures/genome';
import { HISTORY_MAX, TICKS_PER_DAY, STATS_INTERVAL } from './constants';

export const SERIES = [
  'tick', 'population', 'species', 'births', 'deaths', 'avgLifespan', 'avgIntelligence', 'avgSize', 'avgSpeed',
  'avgColdTol', 'avgHeatTol', 'avgDiet', 'avgPerception', 'geneticDiversity', 'biodiversity', 'mutations', 'tribes', 'settlements',
  'temperature', 'rainfall', 'vegetation', 'ecoHealth', 'herbivores', 'omnivores', 'carnivores', 'infected',
] as const;

export class StatsTracker {
  history: Record<string, number[]> = Object.fromEntries(SERIES.map((k) => [k, []]));
  speciesHistory: Record<number, number[]> = {};
  stride = 1;
  counter = 0;
  latest: Record<string, number> = {};

  /** Collect a sample (called every STATS_INTERVAL ticks). */
  sample(sim: Simulation): void {
    const s = this.compute(sim);
    this.latest = s;
    this.counter++;
    if (this.counter % this.stride !== 0) return;
    for (const k of SERIES) this.history[k].push(s[k] ?? 0);
    const n = this.history.tick.length;
    for (const sp of sim.species.list) {
      let arr = this.speciesHistory[sp.id];
      if (!arr) {
        if (sp.population === 0) continue;
        arr = this.speciesHistory[sp.id] = new Array(n - 1).fill(0);
      }
      arr.push(sp.extinctTick === null ? sp.population : 0);
    }
    if (n > HISTORY_MAX) this.downsample();
  }

  private downsample(): void {
    for (const k of SERIES) this.history[k] = this.history[k].filter((_, i) => i % 2 === 0);
    for (const id of Object.keys(this.speciesHistory)) {
      const key = Number(id);
      this.speciesHistory[key] = this.speciesHistory[key].filter((_, i) => i % 2 === 0);
      if (this.speciesHistory[key].every((v) => v === 0)) delete this.speciesHistory[key];
    }
    this.stride *= 2;
  }

  compute(sim: Simulation): Record<string, number> {
    const cs = sim.creatures;
    const n = cs.length;
    let int = 0, size = 0, speed = 0, cold = 0, heat = 0, diet = 0, perc = 0, herb = 0, omni = 0, carn = 0, infected = 0;
    for (const c of cs) {
      int += c.intelligence; size += c.genome[G.size]; speed += c.genome[G.speed]; cold += c.coldTol; heat += c.heatTol;
      diet += c.diet; perc += c.genome[G.perception];
      if (c.diet < 0.35) herb++; else if (c.diet > 0.6) carn++; else omni++;
      if (c.infection > 0) infected++;
    }
    const inv = n > 0 ? 1 / n : 0;
    // Genetic diversity: mean per-gene standard deviation over a sample.
    let gd = 0;
    if (n > 1) {
      const step = Math.max(1, Math.floor(n / 400));
      const fg = FUNCTIONAL_GENES.length;
      const sum = new Float64Array(fg), sq = new Float64Array(fg);
      let m = 0;
      for (let i = 0; i < n; i += step) {
        const g = cs[i].genome;
        for (let k = 0; k < fg; k++) { sum[k] += g[k]; sq[k] += g[k] * g[k]; }
        m++;
      }
      for (let k = 0; k < fg; k++) {
        const mean = sum[k] / m;
        gd += Math.sqrt(Math.max(0, sq[k] / m - mean * mean));
      }
      gd /= fg;
    }
    // Biodiversity: effective number of species (exp Shannon).
    let H = 0;
    const alive = sim.species.list.filter((s) => s.extinctTick === null && s.population > 0);
    for (const s of alive) {
      const p = s.population / Math.max(1, n);
      if (p > 0) H -= p * Math.log(p);
    }
    const biodiversity = Math.exp(H);
    const veg = sim.lastVeg.capacity > 0 ? sim.lastVeg.total / sim.lastVeg.capacity : 0;
    const prevPop = this.history.population.length ? this.history.population[this.history.population.length - 1] : n;
    const stability = n > 0 ? Math.max(0, 1 - Math.abs(n - prevPop) / Math.max(1, prevPop) * 4) : 0;
    const carnFrac = n > 0 ? carn / n : 0;
    const trophic = carn === 0 ? 0.6 : carnFrac > 0.35 ? Math.max(0, 1 - (carnFrac - 0.35) * 3) : 1;
    const eco = n === 0 ? Math.round(veg * 20) : Math.round(25 * Math.min(1, veg * 1.2) + 25 * Math.min(1, biodiversity / 4) + 25 * stability + 25 * trophic);
    const periodTicks = STATS_INTERVAL;
    const out: Record<string, number> = {
      tick: sim.tick,
      population: n,
      species: alive.length,
      births: sim.birthsPeriod,
      deaths: sim.deathsPeriod,
      avgLifespan: sim.deathsPeriod > 0 ? sim.deathAgePeriod / sim.deathsPeriod / TICKS_PER_DAY : (this.latest.avgLifespan ?? 0),
      avgIntelligence: int * inv,
      avgSize: size * inv,
      avgSpeed: speed * inv,
      avgColdTol: cold * inv,
      avgHeatTol: heat * inv,
      avgDiet: diet * inv,
      avgPerception: perc * inv,
      geneticDiversity: gd,
      biodiversity,
      mutations: sim.birthsPeriod > 0 ? sim.mutationsPeriod / sim.birthsPeriod : 0,
      tribes: sim.civ.activeTribes().length,
      settlements: sim.civ.activeSettlements().length,
      temperature: sim.avgTemperature(),
      rainfall: sim.climate.effectiveRain() * (0.5 + sim.climate.cells.length / 16),
      vegetation: veg,
      ecoHealth: eco,
      herbivores: herb,
      omnivores: omni,
      carnivores: carn,
      infected,
      periodTicks,
    };
    sim.birthsPeriod = 0;
    sim.deathsPeriod = 0;
    sim.deathAgePeriod = 0;
    sim.mutationsPeriod = 0;
    return out;
  }

  serialize() {
    return { history: this.history, speciesHistory: this.speciesHistory, stride: this.stride, counter: this.counter, latest: this.latest };
  }

  static deserialize(d: ReturnType<StatsTracker['serialize']>): StatsTracker {
    const s = new StatsTracker();
    s.history = d.history;
    for (const k of SERIES) if (!s.history[k]) s.history[k] = new Array(s.history.tick?.length ?? 0).fill(0);
    s.speciesHistory = d.speciesHistory;
    s.stride = d.stride;
    s.counter = d.counter;
    s.latest = d.latest ?? {};
    return s;
  }
}
