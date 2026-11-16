import type { Simulation } from './simulation';
import type { GodCommand } from './types';
import { TICKS_PER_DAY } from './constants';
import { ignite } from './world/vegetation';
import { TEMPLATES } from './scenarios';
import { genomeFromTemplate, randomGenome, G, Genome, GENE_COUNT, clamp01 } from './creatures/genome';
import { createNoise2D } from './noise';

function forCreaturesIn(sim: Simulation, x: number, y: number, r: number, fn: (c: import('./creatures/creature').Creature, d: number) => void): number {
  let n = 0;
  for (const c of sim.creatures) {
    if (!c.alive) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= r) { fn(c, d); n++; }
  }
  return n;
}

function landmassNameAt(sim: Simulation, x: number, y: number): string {
  const lm = sim.world.landmass[sim.world.tileAt(x, y)];
  return lm >= 0 ? sim.world.landmasses[lm]?.name ?? 'the wilds' : 'the sea';
}

/** Raise/lower terrain with smooth falloff; returns true if anything changed. */
function deform(sim: Simulation, x: number, y: number, r: number, f: (dx: number, dy: number, d: number) => number): void {
  const w = sim.world;
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
      if (!w.inBounds(tx, ty)) continue;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const i = w.idx(tx, ty);
      const delta = f(dx, dy, d);
      w.elevation[i] = Math.max(0, Math.min(1, w.elevation[i] + delta));
      if (w.elevation[i] < w.seaLevel) { w.river[i] = 0; w.lake[i] = 0; }
    }
  }
}

export function applyCommand(sim: Simulation, cmd: GodCommand): void {
  const rng = sim.rng, w = sim.world, tick = sim.tick;
  switch (cmd.type) {
    case 'spawn': {
      const spot = w.nearestLand(cmd.x, cmd.y, 60);
      if (!spot) return;
      let speciesId = cmd.speciesId ?? -1;
      let makeGenome: () => Genome;
      if (speciesId >= 0 && sim.species.get(speciesId)) {
        const sp = sim.species.get(speciesId)!;
        makeGenome = () => {
          const g = new Float32Array(GENE_COUNT);
          for (let i = 0; i < GENE_COUNT; i++) g[i] = clamp01(sp.centroid[i] + rng.gauss(0, 0.03));
          return g;
        };
      } else {
        const t = TEMPLATES[cmd.template ?? 'grazer'];
        const base = t ? genomeFromTemplate(t.genes, rng, 0) : randomGenome(rng);
        if (t) base[G.hue] = rng.next();
        const sp = sim.species.create(rng, Array.from(base), -1, tick, 'introduced');
        speciesId = sp.id;
        makeGenome = () => { const g = new Float32Array(GENE_COUNT); for (let i = 0; i < GENE_COUNT; i++) g[i] = clamp01(base[i] + rng.gauss(0, 0.04)); return g; };
        sim.events.push({ tick, cat: 'god', level: 2, title: 'A new species appears', text: `${sp.name} (${sp.common}) has been introduced near ${landmassNameAt(sim, spot.x, spot.y)}.`, x: spot.x, y: spot.y, speciesId });
      }
      for (let k = 0; k < cmd.count; k++) {
        const p = w.nearestLand(spot.x + rng.range(-2.5, 2.5), spot.y + rng.range(-2.5, 2.5), 10) ?? spot;
        sim.addCreature(makeGenome(), p.x, p.y, speciesId, 0, null, null, true);
      }
      sim.fx.push({ kind: 'spawn', x: spot.x, y: spot.y, r: 4, tick });
      return;
    }
    case 'smite': {
      const n = forCreaturesIn(sim, cmd.x, cmd.y, cmd.radius, (c) => sim.kill(c, 'struck down by divine lightning'));
      sim.fx.push({ kind: 'lightning', x: cmd.x, y: cmd.y, r: cmd.radius, tick });
      if (n > 0) sim.events.push({ tick, cat: 'god', level: 1, title: 'Divine wrath', text: `Lightning from the heavens struck down ${n} creature${n > 1 ? 's' : ''}.`, x: cmd.x, y: cmd.y });
      return;
    }
    case 'food': {
      const r = cmd.radius;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(cmd.x + dx), ty = Math.floor(cmd.y + dy);
        if (!w.inBounds(tx, ty)) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const i = w.idx(tx, ty);
        if (!w.isLand(i)) continue;
        if (cmd.amount > 0) {
          if (w.fertility[i] < 0.3) w.fertility[i] = 0.3 + w.fertility[i] * 0.5;
          w.veg[i] = Math.min(15, w.veg[i] + cmd.amount * (1 - d / r));
        } else {
          w.veg[i] *= 0.05;
        }
      }
      sim.fx.push({ kind: cmd.amount > 0 ? 'bloom' : 'blight', x: cmd.x, y: cmd.y, r, tick });
      return;
    }
    case 'weather': {
      sim.climate.spawnCell(rng, w, tick, cmd.x, cmd.y, cmd.kind, true, cmd.kind === 'storm' ? 12 : 14);
      return;
    }
    case 'clearWeather': {
      sim.climate.cells = [];
      sim.climate.droughtTicks = 0;
      return;
    }
    case 'drought': {
      sim.climate.droughtTicks = Math.round(cmd.days * TICKS_PER_DAY);
      sim.climate.droughtSeverity = 0.8;
      sim.events.push({ tick, cat: 'climate', level: 2, title: 'Drought', text: `A great drought grips the world. Rains will fail for ${cmd.days} days.` });
      return;
    }
    case 'globalStorm': {
      for (let k = 0; k < 8; k++) sim.climate.spawnCell(rng, w, tick, rng.range(0, w.width), rng.range(0, w.height), 'storm', true, rng.range(10, 18));
      sim.events.push({ tick, cat: 'climate', level: 2, title: 'Global storms', text: 'Violent storms are sweeping across the whole world.' });
      return;
    }
    case 'earthquake': {
      const mag = Math.max(1, Math.min(10, cmd.magnitude));
      const R = 6 + mag * 2.2;
      const ang = rng.next() * Math.PI;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      const noise = createNoise2D(rng.fork(7));
      deform(sim, cmd.x, cmd.y, R, (dx, dy, d) => {
        const side = dx * ny - dy * nx > 0 ? 1 : -1;
        return (side * 0.035 + noise(dx * 0.3, dy * 0.3) * 0.02) * (mag / 6) * (1 - d / R);
      });
      sim.terrainChanged();
      let hurt = 0;
      forCreaturesIn(sim, cmd.x, cmd.y, R, (c, d) => {
        c.health -= 35 * (mag / 6) * (1 - d / R) * rng.range(0.4, 1.2);
        c.lastDamage = 'crushed in an earthquake';
        hurt++;
        if (c.health <= 0) sim.kill(c, c.lastDamage);
        else if (rng.chance(0.3)) c.remember(tick, 'disaster', 'Survived a terrible earthquake');
      });
      const ruined = sim.civ.damageArea(sim, cmd.x, cmd.y, R, 30 * mag / 6, 'an earthquake');
      sim.fx.push({ kind: 'quake', x: cmd.x, y: cmd.y, r: R, tick });
      sim.events.push({ tick, cat: 'disaster', level: 3, title: `Earthquake (M${mag.toFixed(1)})`, text: `A magnitude ${mag.toFixed(1)} earthquake shook ${landmassNameAt(sim, cmd.x, cmd.y)}${hurt ? `, injuring ${hurt} creatures` : ''}${ruined ? ` and levelling ${ruined} settlement${ruined > 1 ? 's' : ''}` : ''}.`, x: cmd.x, y: cmd.y });
      return;
    }
    case 'meteor': {
      const R = 4.5;
      deform(sim, cmd.x, cmd.y, R + 2.5, (_dx, _dy, d) => (d < R ? -0.22 * (1 - (d / R) ** 2) : 0.03 * (1 - (d - R) / 2.5)));
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const tx = Math.floor(cmd.x) + dx, ty = Math.floor(cmd.y) + dy;
        if (!w.inBounds(tx, ty) || Math.hypot(dx, dy) > 3) continue;
        const i = w.idx(tx, ty);
        if (w.elevation[i] < w.seaLevel && w.landmass[i] >= 0) { w.elevation[i] = w.seaLevel + 0.001; w.lake[i] = 1; }
        else if (w.elevation[i] >= w.seaLevel) w.lake[i] = 1;
      }
      sim.terrainChanged();
      let dead = 0;
      forCreaturesIn(sim, cmd.x, cmd.y, 10, (c, d) => {
        if (d < 4.5) { sim.kill(c, 'vaporised by a meteor'); dead++; return; }
        c.health -= 60 * (1 - d / 10);
        c.lastDamage = 'killed by a meteor impact';
        if (c.health <= 0) { sim.kill(c, c.lastDamage); dead++; }
      });
      ignite(w, cmd.x, cmd.y, 10, rng);
      sim.climate.impactWinter -= 2.5 + rng.next() * 2;
      const ruined = sim.civ.damageArea(sim, cmd.x, cmd.y, 12, 120, 'a meteor strike');
      sim.fx.push({ kind: 'meteor', x: cmd.x, y: cmd.y, r: 10, tick });
      sim.events.push({ tick, cat: 'disaster', level: 3, title: 'Meteor strike', text: `A meteor struck ${landmassNameAt(sim, cmd.x, cmd.y)}, killing ${dead} creatures${ruined ? ` and destroying ${ruined} settlement${ruined > 1 ? 's' : ''}` : ''}. Dust darkens the skies.`, x: cmd.x, y: cmd.y });
      return;
    }
    case 'volcano': {
      const spot = w.nearestLand(cmd.x, cmd.y, 30) ?? { x: cmd.x, y: cmd.y };
      deform(sim, spot.x, spot.y, 7, (_dx, _dy, d) => 0.3 * Math.pow(1 - d / 7, 1.6));
      sim.terrainChanged();
      let dead = 0;
      forCreaturesIn(sim, spot.x, spot.y, 8, (c, d) => {
        c.health -= 80 * (1 - d / 8);
        c.lastDamage = 'buried by a volcanic eruption';
        if (c.health <= 0) { sim.kill(c, c.lastDamage); dead++; }
      });
      ignite(w, spot.x, spot.y, 9, rng);
      sim.climate.impactWinter -= 2 + rng.next() * 2;
      const ruined = sim.civ.damageArea(sim, spot.x, spot.y, 10, 90, 'a volcanic eruption');
      sim.fx.push({ kind: 'volcano', x: spot.x, y: spot.y, r: 8, tick });
      sim.events.push({ tick, cat: 'disaster', level: 3, title: 'Volcanic eruption', text: `A volcano erupted on ${landmassNameAt(sim, spot.x, spot.y)}${dead ? `, killing ${dead}` : ''}${ruined ? ` and burying ${ruined} settlement${ruined > 1 ? 's' : ''}` : ''}. Ash cools the world.`, x: spot.x, y: spot.y });
      return;
    }
    case 'wildfire': {
      const lit = ignite(w, cmd.x, cmd.y, 3, rng);
      sim.fx.push({ kind: 'fire', x: cmd.x, y: cmd.y, r: 3, tick });
      if (lit > 0) sim.events.push({ tick, cat: 'disaster', level: 2, title: 'Wildfire', text: `A wildfire broke out on ${landmassNameAt(sim, cmd.x, cmd.y)}.`, x: cmd.x, y: cmd.y });
      return;
    }
    case 'plague': {
      const n = forCreaturesIn(sim, cmd.x, cmd.y, 7, (c) => { if (c.immuneTicks === 0) c.infection = 700 + rng.int(0, 300); });
      sim.fx.push({ kind: 'plague', x: cmd.x, y: cmd.y, r: 7, tick });
      sim.events.push({ tick, cat: 'disaster', level: 2, title: 'Plague', text: `A plague has broken out on ${landmassNameAt(sim, cmd.x, cmd.y)}, infecting ${n} creatures.`, x: cmd.x, y: cmd.y });
      return;
    }
    case 'terraform': {
      deform(sim, cmd.x, cmd.y, cmd.radius, (_dx, _dy, d) => cmd.delta * (1 - (d / cmd.radius) ** 2));
      sim.terrainChanged();
      return;
    }
    case 'setParam': {
      const v = cmd.value;
      if (cmd.key === 'tempOffset') sim.climate.tempOffset = v;
      else if (cmd.key === 'rainMult') sim.climate.rainMult = v;
      else if (cmd.key === 'foodMult') sim.settings.foodMult = v;
      else if (cmd.key === 'mutationRate') sim.settings.mutationRate = v;
      else if (cmd.key === 'disasterRate') sim.settings.disasterRate = v;
      return;
    }
    case 'introduceSpecies': {
      const t = TEMPLATES[cmd.template];
      const genes = t ? genomeFromTemplate(t.genes, rng, 0) : randomGenome(rng);
      genes[G.hue] = rng.next();
      genes[G.pattern] = rng.next();
      let x = cmd.x, y = cmd.y;
      if (x === undefined || y === undefined) {
        const site = sim.findSpawnSite(genes);
        x = site.x; y = site.y;
      }
      applyCommand(sim, { type: 'spawn', x, y, count: cmd.count, template: undefined, speciesId: sim.species.create(rng, Array.from(genes), -1, tick, 'introduced').id });
      const sp = sim.species.list[sim.species.list.length - 1];
      sim.events.push({ tick, cat: 'god', level: 2, title: 'A new species appears', text: `${cmd.count} ${sp.common}s (${sp.name}) have appeared on ${landmassNameAt(sim, x, y)}.`, x, y, speciesId: sp.id });
      return;
    }
    case 'cull': {
      let n = 0;
      for (const c of sim.creatures) if (c.alive && rng.chance(cmd.percent / 100)) { sim.kill(c, 'taken by a mysterious blight'); n++; }
      sim.events.push({ tick, cat: 'god', level: 2, title: 'The great culling', text: `A mysterious blight took ${n} lives across the world.` });
      return;
    }
    case 'addRandom': {
      const alive = sim.species.alive().filter((s) => s.population > 0);
      if (alive.length === 0) {
        applyCommand(sim, { type: 'introduceSpecies', template: 'grazer', count: cmd.count });
        return;
      }
      for (let k = 0; k < cmd.count; k += 6) {
        const sp = rng.pick(alive);
        const site = sim.findSpawnSite(Float32Array.from(sp.centroid));
        applyCommand(sim, { type: 'spawn', x: site.x, y: site.y, count: Math.min(6, cmd.count - k), speciesId: sp.id });
      }
      return;
    }
    case 'climateShift': {
      sim.climate.tempTrend = cmd.trend;
      sim.climate.trendLimit = cmd.limit;
      return;
    }
    case 'iceAge': {
      sim.climate.tempTrend = -5;
      sim.climate.trendLimit = sim.climate.drift - 14;
      sim.events.push({ tick, cat: 'climate', level: 3, title: 'An ice age begins', text: 'The sun dims and the world begins to freeze. Glaciers will advance for years to come.' });
      return;
    }
    case 'bless': {
      const c = sim.byId.get(cmd.creatureId);
      if (!c || !c.alive) return;
      c.health = c.maxHealth;
      c.energy = c.maxEnergy;
      c.hydration = 1;
      c.infection = 0;
      c.remember(tick, 'blessed', 'Touched by a divine light and made whole');
      sim.fx.push({ kind: 'bless', x: c.x, y: c.y, r: 2, tick });
      return;
    }
  }
}

/** Random natural disasters, rolled once per day. */
export function rollNaturalDisasters(sim: Simulation): void {
  const rng = sim.rng, w = sim.world;
  const rate = sim.settings.disasterRate;
  if (rate <= 0 || !rng.chance(0.03 * rate)) return;
  let x = 0, y = 0;
  for (let k = 0; k < 20; k++) {
    x = rng.range(0, w.width); y = rng.range(0, w.height);
    if (w.isLand(w.tileAt(x, y))) break;
  }
  const season = sim.climate.season(sim.tick);
  const opts: [string, number][] = [
    ['storm', 3], ['wildfire', season === 1 ? 3 : 0.8], ['earthquake', 1.5], ['drought', sim.climate.droughtTicks > 0 ? 0 : season === 1 ? 1.4 : 0.5],
    ['plague', sim.creatures.length > 400 ? 1 : 0.2], ['meteor', 0.25], ['volcano', 0.35],
  ];
  const total = opts.reduce((s, o) => s + o[1], 0);
  let r = rng.next() * total;
  let pick = 'storm';
  for (const [k, v] of opts) { r -= v; if (r <= 0) { pick = k; break; } }
  switch (pick) {
    case 'storm':
      for (let k = 0; k < 3; k++) sim.climate.spawnCell(rng, w, sim.tick, x + rng.range(-15, 15), y + rng.range(-15, 15), 'storm', true, rng.range(10, 16));
      sim.events.push({ tick: sim.tick, cat: 'climate', level: 1, title: 'Storm front', text: `A violent storm front is moving across ${landmassNameAt(sim, x, y)}.`, x, y });
      break;
    case 'wildfire': applyCommand(sim, { type: 'wildfire', x, y }); break;
    case 'earthquake': applyCommand(sim, { type: 'earthquake', x, y, magnitude: rng.range(3, 7.5) }); break;
    case 'drought': applyCommand(sim, { type: 'drought', days: rng.int(4, 10) }); break;
    case 'plague': {
      const c = sim.creatures[rng.int(0, sim.creatures.length - 1)];
      if (c) applyCommand(sim, { type: 'plague', x: c.x, y: c.y });
      break;
    }
    case 'meteor': applyCommand(sim, { type: 'meteor', x, y }); break;
    case 'volcano': applyCommand(sim, { type: 'volcano', x, y }); break;
  }
}
