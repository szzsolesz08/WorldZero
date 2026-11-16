/**
 * Civilization diagnostics: per-tribe and per-settlement economy snapshots.
 *   npx tsx scripts/civdiag.ts [scenarioId] [years] [seed] [snapshots]
 */
import { Simulation } from '../src/engine/simulation';
import { getScenario } from '../src/engine/scenarios';
import { TICKS_PER_YEAR } from '../src/engine/constants';
import { housingOf } from '../src/engine/civ/settlements';
import { goalLabels } from '../src/engine/civ/strategy';

const sc = getScenario(process.argv[2] ?? 'civilization')!;
const years = Number(process.argv[3] ?? 1);
const seed = process.argv[4] ?? 'soak-1';
const snaps = Number(process.argv[5] ?? 4);
const sim = Simulation.create(sc, seed);
const total = Math.round(years * TICKS_PER_YEAR);
const every = Math.round(total / snaps);
const f = (x: number, d = 1) => x.toFixed(d);
for (let t = 1; t <= total; t++) {
  sim.step();
  if (t % every !== 0) continue;
  console.log(`\n--- y${f(t / TICKS_PER_YEAR, 2)} groups=${sim.civ.groups.length} ${JSON.stringify(sim.civ.counters)}`);
  for (const tr of sim.civ.activeTribes()) {
    console.log(`${tr.name} pop=${tr.population} stab=${f(tr.stability, 2)} goals=${goalLabels(tr.goals).join('/')} techs=${tr.techs.length} homeless=${sim.civ.homeless.get(tr.id)?.length ?? 0}`);
    for (const sid of tr.settlementIds) {
      const s = sim.civ.settlement(sid)!;
      const e = s.econ;
      console.log(`   ${s.name} [${s.state}] n=${s.population} house=${f(housingOf(s))} food=${f(s.stock.food)} wood=${f(s.stock.wood)} prod=${f(e.foodProd)} cons=${f(e.foodCons)} res=${f(e.reserveDays)}d pros=${f(e.prosperity, 2)} press=${f(e.pressure, 2)} prob=${e.mainProblem || '-'} tier=${s.tier} farms=${s.farms.length}`);
    }
  }
}
