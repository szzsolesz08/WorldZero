/**
 * Headless balance runner.
 *   npx tsx scripts/soak.ts [scenarioId|all] [years] [seed]
 * Prints population trajectories, species, civilization progress and tick performance.
 */
import { Simulation } from '../src/engine/simulation';
import { SCENARIOS, getScenario } from '../src/engine/scenarios';
import { TICKS_PER_YEAR, TICKS_PER_DAY } from '../src/engine/constants';
import { CIV_INTERVAL } from '../src/engine/civ/civilization';
import { checkInvariants } from '../src/engine/invariants';

const which = process.argv[2] ?? 'primordial';
const years = Number(process.argv[3] ?? 2);
const seed = process.argv[4] ?? 'soak-1';
const list = which === 'all' ? SCENARIOS : [getScenario(which)!];

for (const sc of list) {
  const t0 = performance.now();
  const sim = Simulation.create(sc, seed);
  const tGen = performance.now() - t0;
  console.log(`\n=== ${sc.name} (seed ${seed}) — worldgen ${tGen.toFixed(0)}ms, ${sim.creatures.length} creatures ===`);
  const total = Math.round(years * TICKS_PER_YEAR);
  const report = Math.round(TICKS_PER_YEAR / 8);
  let tTick = 0, minPop = Infinity, maxPop = 0, violations = 0;
  const states = () => {
    const m: Record<string, number> = {};
    for (const s of sim.civ.settlements) { const k = s.reclaimed ? 'reclaimed' : s.state; m[k] = (m[k] ?? 0) + 1; }
    return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(' ');
  };
  for (let t = 1; t <= total; t++) {
    const a = performance.now();
    sim.step();
    tTick += performance.now() - a;
    const n = sim.creatures.length;
    if (t > TICKS_PER_DAY * 4) { minPop = Math.min(minPop, n); maxPop = Math.max(maxPop, n); }
    if (t % CIV_INTERVAL === 0 && t % (CIV_INTERVAL * 8) === 0) {
      const errs = checkInvariants(sim, true);
      if (errs.length) { violations += errs.length; if (violations <= 20) console.log(`INVARIANT t=${t}: ${errs.slice(0, 4).join('; ')}`); }
    }
    if (t % report === 0) {
      const sp = sim.species.alive().filter((s) => s.population > 0).sort((x, y) => y.population - x.population);
      const env = sim.environment();
      const st = sim.stats.latest;
      console.log(
        `y${(t / TICKS_PER_YEAR).toFixed(2)} pop=${n} sp=${sp.length} gen=${sim.maxGeneration} ` +
        `veg=${(env.vegetation * 100).toFixed(0)}% T=${(st.temperature ?? 0).toFixed(1)} ` +
        `tribes=${sim.civ.activeTribes().length} towns=${sim.civ.activeSettlements().length} ` +
        `ms/tick=${(tTick / report).toFixed(2)} | ` +
        sp.slice(0, 7).map((s) => `${s.common}:${s.population}`).join(' '),
      );
      const civ = sim.civ;
      const sapients = sim.creatures.filter((c) => c.tribeId >= 0).length;
      console.log(`    civ: members=${sapients} migrating=${civ.groups.reduce((a, g) => a + g.members.length, 0)} in ${civ.groups.length} groups | ${states()}`);
      tTick = 0;
    }
    if (n === 0 && t > 100) { console.log(`ALL LIFE EXTINCT at tick ${t}`); break; }
  }
  console.log(`counters: ${JSON.stringify(sim.civ.counters)}`);
  console.log(`invariant violations: ${violations}`);
  const cats: Record<string, number> = {};
  for (const e of sim.events.events) cats[e.cat] = (cats[e.cat] ?? 0) + 1;
  console.log(`events kept: ${JSON.stringify(cats)}; total pushed ${sim.events.nextId - 1}`);
  const titles: Record<string, number> = {};
  for (const e of sim.events.events) { const k = e.title.replace(/ (in|of|from|to|leave|abandoned|declines|thrives|recovers|reach|arrive in) .*$/, ' $1 …'); titles[k] = (titles[k] ?? 0) + 1; }
  console.log('top titles: ' + Object.entries(titles).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k}×${v}`).join(', '));
  const causes = Object.entries(sim.deathCauses).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(', ');
  console.log(`pop range ${minPop}..${maxPop}; births ${sim.totalBirths}, deaths ${sim.totalDeaths}; causes: ${causes}`);
  const techs = sim.civ.activeTribes().map((t) => `${t.name}[${t.population}] ${t.techs.join(',')}`).slice(0, 5);
  if (techs.length) console.log('civs:', techs.join(' | '));
  const evs = sim.events.events.filter((e) => e.level >= 2).slice(-12).map((e) => `  [${(e.tick / TICKS_PER_YEAR).toFixed(2)}] ${e.title}: ${e.text}`);
  console.log('recent major events:\n' + evs.join('\n'));
}
