// Dev helper: track per-island genetic divergence in the Island Experiment.
import { Simulation } from '../src/engine/simulation';
import { getScenario } from '../src/engine/scenarios';
import { centroid, geneticDistance } from '../src/engine/creatures/genome';
const sim = Simulation.create(getScenario('islands')!, process.argv[2] ?? 'drift-cinder-1522');
const years = Number(process.argv[3] ?? 6);
for (let t = 1; t <= years * 4800; t++) {
  sim.step();
  if (t % 2400 !== 0) continue;
  const line: string[] = [];
  for (const sp of sim.species.alive().filter((s) => s.population > 0)) {
    const byLand = new Map<number, Float32Array[]>();
    for (const c of sim.creatures) {
      if (c.speciesId !== sp.id) continue;
      const lm = sim.world.landmass[sim.world.tileAt(c.x, c.y)];
      if (lm < 0) continue;
      (byLand.get(lm) ?? byLand.set(lm, []).get(lm)!).push(c.genome);
    }
    const groups = [...byLand.values()].filter((g) => g.length >= 8).sort((a, b) => b.length - a.length);
    const main = groups.length ? centroid(groups[0]) : null;
    const d = groups.slice(1).map((g) => `${g.length}:${geneticDistance(main!, centroid(g)).toFixed(3)}`);
    line.push(`${sp.common}[${sp.population}] main=${groups[0]?.length ?? 0} ${d.join(' ')}`);
  }
  console.log(`y${(t / 4800).toFixed(1)} species=${sim.species.alive().filter((s) => s.population > 0).length} | ${line.join(' || ')}`);
}
