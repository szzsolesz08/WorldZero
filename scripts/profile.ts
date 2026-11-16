// Dev helper: per-phase tick cost.  npx tsx scripts/profile.ts [scenario] [warmupYears]
import { Simulation } from '../src/engine/simulation';
import { getScenario } from '../src/engine/scenarios';
const sim = Simulation.create(getScenario(process.argv[2] ?? 'primordial')!, 'soak-1');
const warm = Number(process.argv[3] ?? 2.5) * 4800;
for (let i = 0; i < warm; i++) sim.step();
sim.prof = {};
const N = 1200;
const t0 = performance.now();
for (let i = 0; i < N; i++) sim.step();
const total = performance.now() - t0;
console.log(`pop=${sim.creatures.length} tribes=${sim.civ.activeTribes().length} ms/tick=${(total / N).toFixed(2)}`);
for (const [k, v] of Object.entries(sim.prof).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${(v / N).toFixed(3)} /tick`);

