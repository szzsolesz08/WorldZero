import { Simulation } from '../src/engine/simulation';
import { getScenario } from '../src/engine/scenarios';
const sim = Simulation.create(getScenario('primordial')!, 'soak-1');
for (let i = 0; i < 2.5 * 4800; i++) sim.step();
const sp = sim.spatial;
const counts: number[] = [];
for (let c = 0; c < sp.cols * sp.rows; c++) { const n = sp.countAt(c); if (n) counts.push(n); }
counts.sort((a, b) => b - a);
console.log('occupied cells', counts.length, 'top', counts.slice(0, 10).join(','), 'median', counts[Math.floor(counts.length / 2)]);
// tile-level crowding
const m = new Map<number, number>();
for (const c of sim.creatures) { const k = Math.floor(c.x) + Math.floor(c.y) * 1000; m.set(k, (m.get(k) ?? 0) + 1); }
const t = [...m.values()].sort((a, b) => b - a);
console.log('max creatures on one tile', t.slice(0, 8).join(','));
const acts: Record<string, number> = {};
for (const c of sim.creatures) acts[c.action] = (acts[c.action] ?? 0) + 1;
console.log(JSON.stringify(acts));
