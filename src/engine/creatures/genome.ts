import { Rng } from '../rng';
import { MACRO_MUTATION_P, MACRO_MUTATION_SD, MUTATION_SD } from '../constants';

export const GENES = [
  'size', 'speed', 'perception', 'strength', 'intelligence', 'sociability', 'aggression', 'curiosity',
  'fertility', 'longevity', 'coldTol', 'heatTol', 'diet', 'swim', 'immunity', 'nocturnal',
  'hue', 'saturation', 'pattern', 'shape',
] as const;
export type GeneName = (typeof GENES)[number];
export const G: Record<GeneName, number> = Object.fromEntries(GENES.map((g, i) => [g, i])) as Record<GeneName, number>;
export const GENE_COUNT = GENES.length;
/** Genes that influence fitness (appearance genes drift neutrally). */
export const FUNCTIONAL_GENES = GENES.slice(0, 16);

export const GENE_LABELS: Record<GeneName, string> = {
  size: 'Size', speed: 'Speed', perception: 'Perception', strength: 'Strength', intelligence: 'Intelligence',
  sociability: 'Sociability', aggression: 'Aggression', curiosity: 'Curiosity', fertility: 'Fertility',
  longevity: 'Longevity', coldTol: 'Cold tolerance', heatTol: 'Heat tolerance', diet: 'Carnivory',
  swim: 'Swimming', immunity: 'Immunity', nocturnal: 'Nocturnality', hue: 'Hue', saturation: 'Saturation',
  pattern: 'Pattern', shape: 'Body shape',
};

const WEIGHTS = new Float32Array(GENE_COUNT).fill(1);
WEIGHTS[G.diet] = 1.6;
WEIGHTS[G.intelligence] = 1.2;
WEIGHTS[G.hue] = 0.5;
WEIGHTS[G.saturation] = 0.3;
WEIGHTS[G.pattern] = 0.3;
WEIGHTS[G.shape] = 0.3;
let WSUM = 0;
for (const w of WEIGHTS) WSUM += w;

export type Genome = Float32Array;

/** Partial gene template with per-gene mean; unspecified genes default to 0.5. */
export type GenomeTemplate = Partial<Record<GeneName, number>>;

export function genomeFromTemplate(t: GenomeTemplate, rng: Rng, spread = 0.06): Genome {
  const g = new Float32Array(GENE_COUNT);
  for (let i = 0; i < GENE_COUNT; i++) {
    const mean = t[GENES[i]] ?? 0.5;
    g[i] = clamp01(mean + rng.gauss(0, i === G.hue ? spread * 0.5 : spread));
  }
  return g;
}

export function randomGenome(rng: Rng): Genome {
  const g = new Float32Array(GENE_COUNT);
  for (let i = 0; i < GENE_COUNT; i++) g[i] = rng.next();
  // Keep random species viable: moderate extremes.
  g[G.diet] = rng.chance(0.75) ? rng.range(0, 0.35) : rng.range(0.6, 0.95);
  g[G.swim] = rng.range(0, 0.4);
  return g;
}

/** Child genome: per-gene crossover with occasional blending, then mutation. Returns mutation count. */
export function inherit(a: Genome, b: Genome, rng: Rng, mutationRate: number, out: Genome): number {
  for (let i = 0; i < GENE_COUNT; i++) {
    const r = rng.next();
    out[i] = r < 0.4 ? a[i] : r < 0.8 ? b[i] : (a[i] + b[i]) * 0.5;
  }
  return mutate(out, rng, mutationRate);
}

export function mutate(g: Genome, rng: Rng, rate: number): number {
  let count = 0;
  for (let i = 0; i < GENE_COUNT; i++) {
    if (rng.next() < rate) {
      const macro = rng.next() < MACRO_MUTATION_P / Math.max(rate, 1e-3);
      const delta = rng.gauss(0, macro ? MACRO_MUTATION_SD : MUTATION_SD);
      if (i === G.hue) g[i] = ((g[i] + delta) % 1 + 1) % 1;
      else g[i] = clamp01(g[i] + delta);
      count++;
    }
  }
  return count;
}

export function geneticDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < GENE_COUNT; i++) {
    let d = Math.abs(a[i] - b[i]);
    if (i === G.hue && d > 0.5) d = 1 - d;
    s += WEIGHTS[i] * d * d;
  }
  return Math.sqrt(s / WSUM);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function genomeToRecord(g: ArrayLike<number>): Record<GeneName, number> {
  const r = {} as Record<GeneName, number>;
  for (let i = 0; i < GENE_COUNT; i++) r[GENES[i]] = g[i];
  return r;
}

/** Mean genome with circular mean for hue. */
export function centroid(genomes: ArrayLike<number>[]): number[] {
  const c = new Array(GENE_COUNT).fill(0);
  if (genomes.length === 0) return c;
  let hx = 0, hy = 0;
  for (const g of genomes) {
    for (let i = 0; i < GENE_COUNT; i++) c[i] += g[i];
    hx += Math.cos(g[G.hue] * Math.PI * 2);
    hy += Math.sin(g[G.hue] * Math.PI * 2);
  }
  for (let i = 0; i < GENE_COUNT; i++) c[i] /= genomes.length;
  c[G.hue] = ((Math.atan2(hy, hx) / (Math.PI * 2)) % 1 + 1) % 1;
  return c;
}
