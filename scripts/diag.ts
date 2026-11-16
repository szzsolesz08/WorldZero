import { Simulation } from '../src/engine/simulation';
import { getScenario } from '../src/engine/scenarios';
const target = process.argv[2] ?? 'Hunter';
const sim = Simulation.create(getScenario(process.argv[3] ?? 'primordial')!, 'soak-1');
const sp = sim.species.list.find((s) => (target === 'sapient' ? s.sapient : s.common.includes(target)))!;
console.log('tracking', sp.name, sp.common);
const actions: Record<string, number> = {};
const deaths: Record<string, number> = {};
const origKill = sim.kill.bind(sim);
(sim as any).kill = (c: any, cause: string, k?: any) => {
  if (c.speciesId === sp.id && c.alive) {
    const key = k ? `killed by ${sim.species.get(k.speciesId)?.common}${k.tribeId >= 0 ? ' (tribe)' : ''}` : cause.replace(/\(.*\)/, '').slice(0, 30);
    deaths[key] = (deaths[key] ?? 0) + 1;
  }
  return origKill(c, cause, k);
};
let births = 0;
const T = Number(process.argv[4] ?? 1) * 4800;
for (let t = 1; t <= T; t++) {
  const before = sim.species.get(sp.id)!.totalBorn;
  sim.step();
  births += sim.species.get(sp.id)!.totalBorn - before;
  for (const c of sim.creatures) if (c.speciesId === sp.id) actions[c.action] = (actions[c.action] ?? 0) + 1;
  if (t % (T / 8) === 0) {
    const ms = sim.creatures.filter((c) => c.speciesId === sp.id);
    const e = ms.reduce((s, c) => s + c.energy / c.maxEnergy, 0) / Math.max(1, ms.length);
    const h = ms.reduce((s, c) => s + c.hydration, 0) / Math.max(1, ms.length);
    const kills = ms.reduce((s, c) => s + c.kills, 0);
    const mature = ms.filter((c) => c.mature).length;
    const canmate = ms.filter((c) => c.mature && c.cooldown === 0 && c.energy > c.maxEnergy * 0.5).length;
    console.log(`t=${t} n=${ms.length} mature=${mature} canMate=${canmate} energy=${e.toFixed(2)} hyd=${h.toFixed(2)} kills=${kills} births=${births}`);
    console.log('  actions', JSON.stringify(actions));
    console.log('  deaths', JSON.stringify(deaths));
    for (const k in actions) actions[k] = 0;
  }
}
