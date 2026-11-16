import { Rng } from '../rng';
import { centroid, geneticDistance, genomeToRecord, G } from '../creatures/genome';
import { commonNameFor, epithetFor, genusName, makeLanguage } from '../creatures/names';
import type { Creature } from '../creatures/creature';
import type { World } from '../world/world';
import { ALLOPATRIC_THRESHOLD, MIN_SPECIES_SPLIT, SPECIATION_THRESHOLD } from '../constants';
import type { SpeciesView } from '../types';

export type SpeciesOrigin = 'primordial' | 'speciation' | 'allopatric' | 'introduced';

export interface SpeciesRecord {
  id: number;
  genus: string;
  epithet: string;
  name: string;
  common: string;
  parentId: number;
  originTick: number;
  extinctTick: number | null;
  origin: SpeciesOrigin;
  lang: number[];
  centroid: number[];
  population: number;
  peak: number;
  totalBorn: number;
  generationMax: number;
  landmasses: number[];
  hue: number;
  sat: number;
  diet: 'herbivore' | 'omnivore' | 'carnivore';
  sapient: boolean;
  /** Rolling reference for decline/boom detection. */
  refPop: number;
  refTick: number;
}

export interface SplitResult {
  child: SpeciesRecord;
  parent: SpeciesRecord;
  members: Creature[];
  origin: SpeciesOrigin;
  distance: number;
}

export class SpeciesRegistry {
  list: SpeciesRecord[] = [];
  byId = new Map<number, SpeciesRecord>();
  nextId = 1;

  create(rng: Rng, genomeCentroid: number[], parentId: number, tick: number, origin: SpeciesOrigin): SpeciesRecord {
    const parent = this.byId.get(parentId);
    const traits = genomeToRecord(genomeCentroid);
    let genus = parent && geneticDistance(parent.centroid, genomeCentroid) < 0.2 ? parent.genus : genusName(rng);
    let epithet = epithetFor(traits, rng);
    let name = `${genus} ${epithet}`;
    let n = 2;
    const roman = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    while (this.list.some((s) => s.name === name)) {
      name = `${genus} ${epithet} ${roman[n] ?? n}`;
      n++;
    }
    const rec: SpeciesRecord = {
      id: this.nextId++,
      genus, epithet, name,
      common: commonNameFor(traits, rng),
      parentId,
      originTick: tick,
      extinctTick: null,
      origin,
      lang: parent && rng.chance(0.6) ? mutateLang(parent.lang, rng) : makeLanguage(rng),
      centroid: genomeCentroid.slice(),
      population: 0,
      peak: 0,
      totalBorn: 0,
      generationMax: 0,
      landmasses: [],
      hue: genomeCentroid[G.hue],
      sat: genomeCentroid[G.saturation],
      diet: classifyDiet(genomeCentroid[G.diet]),
      sapient: genomeCentroid[G.intelligence] > 0.6,
      refPop: 0,
      refTick: tick,
    };
    this.list.push(rec);
    this.byId.set(rec.id, rec);
    return rec;
  }

  get(id: number): SpeciesRecord | undefined {
    return this.byId.get(id);
  }

  alive(): SpeciesRecord[] {
    return this.list.filter((s) => s.extinctTick === null);
  }

  /** Recount populations and centroids; returns species that just went extinct. */
  refresh(creatures: Creature[], tick: number): SpeciesRecord[] {
    const groups = new Map<number, Creature[]>();
    for (const c of creatures) {
      if (!c.alive) continue;
      let g = groups.get(c.speciesId);
      if (!g) { g = []; groups.set(c.speciesId, g); }
      g.push(c);
    }
    const extinct: SpeciesRecord[] = [];
    for (const s of this.list) {
      if (s.extinctTick !== null) continue;
      const members = groups.get(s.id) ?? [];
      s.population = members.length;
      if (s.population > s.peak) s.peak = s.population;
      if (members.length > 0) {
        const sample = members.length > 300 ? members.filter((_, i) => i % Math.ceil(members.length / 300) === 0) : members;
        s.centroid = centroid(sample.map((c) => c.genome));
        s.hue = s.centroid[G.hue];
        s.sat = s.centroid[G.saturation];
        s.diet = classifyDiet(s.centroid[G.diet]);
        s.sapient = s.centroid[G.intelligence] > 0.6;
        for (const c of members) if (c.generation > s.generationMax) s.generationMax = c.generation;
      } else if (tick - s.originTick > 0) {
        s.extinctTick = tick;
        extinct.push(s);
      }
    }
    return extinct;
  }

  /** Detect divergence inside species and split off new ones. */
  speciate(creatures: Creature[], world: World, rng: Rng, tick: number): SplitResult[] {
    const groups = new Map<number, Creature[]>();
    for (const c of creatures) {
      if (!c.alive) continue;
      let g = groups.get(c.speciesId);
      if (!g) { g = []; groups.set(c.speciesId, g); }
      g.push(c);
    }
    const results: SplitResult[] = [];
    for (const [sid, members] of groups) {
      if (members.length < MIN_SPECIES_SPLIT * 2) continue;
      const parent = this.byId.get(sid);
      if (!parent) continue;
      if (tick - parent.originTick < 1200) continue; // let new species settle first

      // (a) Allopatric: populations isolated on different landmasses that have drifted apart.
      const byLand = new Map<number, Creature[]>();
      for (const c of members) {
        const lm = world.landmass[world.tileAt(c.x, c.y)];
        if (lm < 0) continue;
        let g = byLand.get(lm);
        if (!g) { g = []; byLand.set(lm, g); }
        g.push(c);
      }
      if (byLand.size >= 2) {
        const lands = [...byLand.values()].filter((g) => g.length >= MIN_SPECIES_SPLIT).sort((a, b) => b.length - a.length);
        if (lands.length >= 2) {
          const main = centroid(lands[0].map((c) => c.genome));
          let split = false;
          for (let k = 1; k < lands.length && !split; k++) {
            const other = centroid(lands[k].map((c) => c.genome));
            const d = geneticDistance(main, other);
            if (d > ALLOPATRIC_THRESHOLD) {
              const child = this.create(rng, other, sid, tick, 'allopatric');
              for (const c of lands[k]) c.speciesId = child.id;
              child.population = lands[k].length;
              child.peak = child.population;
              results.push({ child, parent, members: lands[k], origin: 'allopatric', distance: d });
              split = true;
            }
          }
          if (split) continue;
        }
      }

      // (b) Sympatric: 2-means in genome space.
      const sample = members.length > 300 ? members.filter((_, i) => i % Math.ceil(members.length / 300) === 0) : members;
      const a = sample[rng.int(0, sample.length - 1)];
      let b = a, bd = -1;
      for (const c of sample) {
        const d = geneticDistance(a.genome, c.genome);
        if (d > bd) { bd = d; b = c; }
      }
      let ca: number[] = Array.from(a.genome), cb: number[] = Array.from(b.genome);
      let ga: Creature[] = [], gb: Creature[] = [];
      for (let iter = 0; iter < 6; iter++) {
        ga = []; gb = [];
        for (const c of sample) (geneticDistance(c.genome, ca) <= geneticDistance(c.genome, cb) ? ga : gb).push(c);
        if (ga.length === 0 || gb.length === 0) break;
        ca = centroid(ga.map((c) => c.genome));
        cb = centroid(gb.map((c) => c.genome));
      }
      if (ga.length === 0 || gb.length === 0) continue;
      const d = geneticDistance(ca, cb);
      if (d <= SPECIATION_THRESHOLD) continue;
      const fa: Creature[] = [], fb: Creature[] = [];
      for (const c of members) (geneticDistance(c.genome, ca) <= geneticDistance(c.genome, cb) ? fa : fb).push(c);
      const [, smallC, small] = fa.length >= fb.length ? [ca, cb, fb] as const : [cb, ca, fa] as const;
      if (small.length < MIN_SPECIES_SPLIT) continue;
      const child = this.create(rng, smallC, sid, tick, 'speciation');
      for (const c of small) c.speciesId = child.id;
      child.population = small.length;
      child.peak = child.population;
      results.push({ child, parent, members: small, origin: 'speciation', distance: d });
    }
    return results;
  }

  view(s: SpeciesRecord): SpeciesView {
    return {
      id: s.id,
      name: s.name,
      common: s.common,
      parentId: s.parentId,
      originTick: s.originTick,
      extinctTick: s.extinctTick,
      origin: s.origin,
      color: speciesColor(s.hue, s.sat),
      hue: s.hue,
      population: s.population,
      peak: s.peak,
      totalBorn: s.totalBorn,
      diet: s.diet,
      sapient: s.sapient,
      traits: genomeToRecord(s.centroid),
      generationMax: s.generationMax,
      landmasses: s.landmasses.length,
    };
  }

  serialize() {
    return { list: this.list.map((s) => ({ ...s, centroid: s.centroid.slice(), lang: s.lang.slice(), landmasses: s.landmasses.slice() })), nextId: this.nextId };
  }

  static deserialize(d: ReturnType<SpeciesRegistry['serialize']>): SpeciesRegistry {
    const r = new SpeciesRegistry();
    r.list = d.list.map((s) => ({ ...s }));
    for (const s of r.list) r.byId.set(s.id, s);
    r.nextId = d.nextId;
    return r;
  }
}

export function classifyDiet(d: number): 'herbivore' | 'omnivore' | 'carnivore' {
  return d < 0.35 ? 'herbivore' : d > 0.6 ? 'carnivore' : 'omnivore';
}

export function speciesColor(hue: number, sat: number): string {
  return `hsl(${Math.round(hue * 360)}, ${Math.round(48 + sat * 40)}%, 62%)`;
}

function mutateLang(lang: number[], rng: Rng): number[] {
  const out = lang.slice();
  const k = rng.int(0, out.length - 1);
  out[k] = (out[k] + rng.int(1, 40)) % 48;
  return out;
}
