import { Rng } from '../rng';

const SYLLABLES = [
  'ka', 'lo', 'ri', 'ze', 'tha', 'mu', 'vo', 'e', 'sa', 'du', 'qi', 'ra', 'o', 'fe', 'yl', 'bra',
  'ti', 'ko', 'a', 'u', 'ni', 'sha', 'go', 'me', 'ru', 'ix', 'al', 'ver', 'dra', 'li', 'mor', 'en',
  'zu', 'kai', 'tor', 'wy', 'is', 'nar', 'pe', 'sol', 'gri', 'tu', 'ha', 'ess', 'or', 'vi', 'ul', 'ae',
];

/** A species "language": a small subset of syllables giving names a shared sound. */
export function makeLanguage(rng: Rng): number[] {
  const n = rng.int(7, 11);
  const out: number[] = [];
  while (out.length < n) {
    const s = rng.int(0, SYLLABLES.length - 1);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function word(rng: Rng, lang: number[], minS: number, maxS: number): string {
  const n = rng.int(minS, maxS);
  let w = '';
  for (let i = 0; i < n; i++) w += SYLLABLES[lang[rng.int(0, lang.length - 1)]];
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function creatureName(rng: Rng, lang: number[]): string {
  return word(rng, lang, 2, 3);
}

export function tribeName(rng: Rng, lang: number[]): string {
  const forms = ['The {} Clan', 'The {} Tribe', '{} Folk', 'The {}i', 'House of {}', 'The {} Band', 'Children of {}'];
  return rng.pick(forms).replace('{}', word(rng, lang, 2, 2));
}

export function settlementName(rng: Rng, lang: number[]): string {
  const base = word(rng, lang, 1, 2);
  const suffixes = ['', '', 'hold', 'ford', 'mere', 'stead', 'haven', 'vale', 'rock', 'fall', 'heim', 'gard'];
  return base + rng.pick(suffixes);
}

const GENUS_A = ['Aero', 'Brachy', 'Cerato', 'Dino', 'Eu', 'Glypto', 'Hylo', 'Ichno', 'Lepto', 'Macro', 'Neo', 'Oxy', 'Ptero', 'Rhyncho', 'Sauro', 'Thero', 'Xeno', 'Chloro', 'Lumi', 'Cryo', 'Pyro', 'Sylva', 'Thalasso', 'Mega', 'Proto', 'Helio', 'Noctu', 'Phyllo'];
const GENUS_B = ['therium', 'saurus', 'don', 'pus', 'mys', 'cephalus', 'gnathus', 'phagus', 'morpha', 'lopex', 'dactylus', 'ceros', 'nyx', 'vora', 'lagus', 'cyon', 'bates'];

export function genusName(rng: Rng): string {
  return rng.pick(GENUS_A) + rng.pick(GENUS_B);
}

/** Trait-driven epithet so names reflect what a species actually is. */
export function epithetFor(traits: Record<string, number>, rng: Rng): string {
  const cands: [string, number][] = [
    ['velox', traits.speed - 0.6],
    ['gigas', traits.size - 0.65],
    ['minor', 0.35 - traits.size],
    ['sapiens', traits.intelligence - 0.6],
    ['sagax', traits.intelligence - 0.5],
    ['ferox', (traits.diet + traits.aggression) / 2 - 0.6],
    ['nocturnus', traits.nocturnal - 0.6],
    ['aquaticus', traits.swim - 0.55],
    ['borealis', traits.coldTol - 0.6],
    ['deserti', traits.heatTol - 0.6],
    ['gregarius', traits.sociability - 0.65],
    ['solitarius', 0.3 - traits.sociability],
    ['robustus', traits.strength - 0.65],
    ['longaevus', traits.longevity - 0.65],
    ['fecundus', traits.fertility - 0.7],
    ['placidus', 0.3 - traits.aggression],
    ['oculatus', traits.perception - 0.65],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  const top = cands.filter((c) => c[1] > 0).slice(0, 3);
  if (top.length === 0) return rng.pick(['vulgaris', 'communis', 'primus', 'varians', 'novus']);
  return rng.pick(top)[0];
}

export function commonNameFor(traits: Record<string, number>, rng: Rng): string {
  let noun: string;
  if (traits.intelligence > 0.6 && traits.sociability > 0.5) noun = rng.pick(['Folk', 'Kin', 'Thinkers', 'Builders']);
  else if (traits.diet > 0.62) noun = rng.pick(['Stalker', 'Hunter', 'Prowler', 'Raptor', 'Fang']);
  else if (traits.diet > 0.38) noun = rng.pick(['Scavenger', 'Rooter', 'Forager', 'Wanderer']);
  else noun = rng.pick(['Grazer', 'Browser', 'Strider', 'Muncher', 'Hopper']);
  const adjs: [string, number][] = [
    ['Swift', traits.speed - 0.6], ['Giant', traits.size - 0.65], ['Tiny', 0.3 - traits.size],
    ['Frost', traits.coldTol - 0.6], ['Dune', traits.heatTol - 0.6], ['Night', traits.nocturnal - 0.6],
    ['River', traits.swim - 0.5], ['Herd', traits.sociability - 0.7], ['Iron', traits.strength - 0.7],
    ['Keen', traits.perception - 0.65], ['Elder', traits.longevity - 0.7], ['Wise', traits.intelligence - 0.55],
    ['Red', 0], ['Pale', 0], ['Striped', 0], ['Spotted', 0], ['Crested', 0], ['Long-tailed', 0],
  ];
  adjs.sort((a, b) => b[1] - a[1]);
  const best = adjs[0][1] > 0 ? adjs[0][0] : rng.pick(adjs.filter((a) => a[1] === 0)).at(0)!;
  return `${best} ${noun}`;
}

export function landmassName(rng: Rng, size: number): string {
  const lang = makeLanguage(rng);
  const w = word(rng, lang, 2, 3);
  if (size < 300) return `Isle of ${w}`;
  if (size < 2500) return `${w} Island`;
  return rng.pick([`${w}`, `${w}ia`, `${w} Reach`, `Lands of ${w}`]);
}
