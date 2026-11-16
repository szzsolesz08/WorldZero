import type { Simulation } from '../simulation';
import type { Creature } from './creature';
import { geneticDistance } from './genome';
import { BIOMES } from '../world/biomes';
import {
  CHUNK, DECIDE_INTERVAL, DEHYDRATE_DAMAGE, DRINK_RATE, MATE_MAX_DISTANCE, MAX_POPULATION, MOVE_COST,
  PLANT_ENERGY, MEAT_ENERGY, REGEN_RATE, STARVE_DAMAGE, THIRST_RATE, BITE, TICKS_PER_YEAR, VEG_RESERVE,
} from '../constants';
import type { Action } from '../types';
import { dist2d } from '../mathutil';
import { eatFromSupplies, migrantTarget } from '../civ/migration';

const nb: Creature[] = [];
const MOVE_OFFSETS = [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2];
const rally: Creature[] = [];

function hurt(c: Creature, amount: number, cause: string): void {
  c.health -= amount;
  c.lastDamage = cause;
}

/** Per-tick physiology, decision and action for one creature. */
export function updateCreature(sim: Simulation, c: Creature): void {
  const w = sim.world, cl = sim.climate, tick = sim.tick;
  c.age++;
  if (c.cooldown > 0) c.cooldown--;
  if (c.attackCd > 0) c.attackCd--;
  const tile = w.tileAt(c.x, c.y);

  // Refresh temperature and shelter every 10 ticks (staggered).
  if ((tick + c.id) % 10 === 0) {
    let t = cl.tileTemp(w, tile, tick);
    const wc = cl.weatherAt(c.x, c.y);
    c.storm = 0;
    if (wc) {
      t -= wc.kind === 'snow' ? 6 * wc.intensity : wc.kind === 'storm' ? 3 * wc.intensity : 1.5 * wc.intensity;
      if (wc.kind === 'storm') c.storm = wc.intensity;
    }
    c.tempNow = t;
    c.shelter = Math.max(BIOMES[w.biome[tile]].shelter * 0.5, sim.civ.shelterFor(c));
  }

  const t = c.tempNow;
  let stress = t < c.comfortLow ? c.comfortLow - t : t > c.comfortHigh ? t - c.comfortHigh : 0;
  stress *= 1 - c.shelter;
  c.stress = stress;

  c.energy -= c.basal * (c.resting ? 0.55 : 1) * (c.mature ? 1 : 0.7) + stress * 0.0035 * c.size;
  c.hydration -= THIRST_RATE * (1 + Math.max(0, t - 24) * 0.04) * (1.2 - 0.4 * c.heatTol) * (c.resting ? 0.7 : 1);
  if (w.rain[tile] > 0.25 && c.hydration < 1) c.hydration = Math.min(1, c.hydration + 0.004 * w.rain[tile]);

  if (c.energy <= 0) { c.energy = 0; hurt(c, STARVE_DAMAGE, 'starvation'); }
  if (c.hydration <= 0) { c.hydration = 0; hurt(c, DEHYDRATE_DAMAGE, 'thirst'); }
  if (stress > 12) hurt(c, (stress - 12) * 0.02, t < c.comfortLow ? 'cold' : 'heat');
  if (c.storm > 0.45 && c.shelter < 0.4 && (tick + c.id) % 5 === 0) hurt(c, 0.25 * c.storm, 'storm');
  if (c.infection > 0) {
    c.infection--;
    hurt(c, 0.06 * (1 - c.immunity * 0.85) / sim.civ.medicineFactor(c), 'plague');
    if (c.infection === 0) c.immuneTicks = TICKS_PER_YEAR;
  } else if (c.immuneTicks > 0) c.immuneTicks--;
  if (c.age > c.lifespan) hurt(c, 0.25 + (c.age - c.lifespan) * 0.003, 'old age');

  if (c.health <= 0) {
    sim.kill(c, c.lastDamage || 'unknown causes');
    return;
  }
  if (c.health < c.maxHealth && c.energy > c.maxEnergy * 0.35 && c.hydration > 0.3 && stress < 6 && c.infection === 0) {
    c.health = Math.min(c.maxHealth, c.health + REGEN_RATE * (1 + c.shelter) * sim.civ.medicineFactor(c));
  }

  if (--c.decideIn <= 0) decide(sim, c);
  act(sim, c);

  // Travel bookkeeping and territory discovery.
  if ((tick + c.id) % 20 === 0) {
    const dx = c.x - c.birthX, dy = c.y - c.birthY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > c.maxTravel) c.maxTravel = d;
    const lm = w.landmass[w.tileAt(c.x, c.y)];
    if (lm >= 0 && lm !== c.lastLandmass) {
      c.lastLandmass = lm;
      sim.onLandmassVisit(c, lm);
    }
  }
}

function isThreat(o: Creature, c: Creature): boolean {
  return o.meatEff > 0.35 && o.speciesId !== c.speciesId && o.effSize > c.effSize * 0.5 && o.diet > c.diet + 0.15 &&
    (c.tribeId < 0 || o.tribeId !== c.tribeId);
}

function canPrey(sim: Simulation, c: Creature, o: Creature, hunger: number): boolean {
  if (o.tribeId >= 0 && o.tribeId === c.tribeId) return false;
  if (o.homeId >= 0 && c.tribeId < 0) {
    // Wild predators steer clear of settlements.
    const s = sim.civ.settlement(o.homeId);
    if (s && Math.abs(s.x - o.x) + Math.abs(s.y - o.y) < 6 + s.tier * 2) return false;
  }
  if (o.speciesId === c.speciesId && !(hunger > 0.85 && c.aggression > 0.8)) return false;
  let limit = 1.15 + (c.sociability > 0.5 ? 0.5 : 0);
  if (c.tribeId >= 0 && sim.civ.hasTech(c.tribeId, 'hunting')) limit += 0.6;
  return o.effSize <= c.effSize * limit;
}

function isKin(a: Creature, b: Creature): boolean {
  return a.motherId === b.id || a.fatherId === b.id || b.motherId === a.id || b.fatherId === a.id ||
    (a.motherId >= 0 && a.motherId === b.motherId);
}

export function speciesLabel(sim: Simulation, id: number): string {
  return sim.species.get(id)?.common ?? 'creature';
}

/** Utility-based action selection. */
export function decide(sim: Simulation, c: Creature): void {
  const w = sim.world, cl = sim.climate, tick = sim.tick, rng = sim.rng;
  c.decideIn = DECIDE_INTERVAL + ((c.id + tick) % 3);
  const night = cl.isNight(tick);
  const restTime = c.nocturnal ? cl.daylight(tick) > 0.65 : night;
  const percMult = night && !c.nocturnal ? 0.6 : 1;
  const perc = c.perception * percMult;
  const n = sim.spatial.query(c.x, c.y, Math.min(perc, 9.5), nb, 32, c);

  const group = c.migrationId >= 0 ? sim.civ.group(c.migrationId) : undefined;
  if (group && c.energy < c.maxEnergy * 0.6) eatFromSupplies(c, group);
  const hunger = 1 - c.energy / c.maxEnergy;
  const thirst = 1 - c.hydration;
  const meatPref = c.meatEff > c.herbEff * 0.75;
  const canMate = c.mature && c.cooldown === 0 && c.energy > c.maxEnergy * 0.5 && c.hydration > 0.35 &&
    c.age < c.lifespan * 0.92 && sim.creatures.length < MAX_POPULATION;
  const atWarTribe = c.tribeId >= 0 && sim.civ.hasEnemies(c.tribeId);

  let threat: Creature | null = null, threatD2 = Infinity;
  let prey: Creature | null = null, preyScore = 0;
  let mate: Creature | null = null, mateScore = 0;
  let friend: Creature | null = null, friendScore = 0;
  let same = 0, sx = 0, sy = 0;
  let childInDanger = false;

  for (let k = 0; k < n; k++) {
    const o = nb[k];
    const dx = o.x - c.x, dy = o.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (c.infection > 0 && d2 < 3 && o.infection === 0 && o.immuneTicks === 0 && rng.next() < 0.045 * (1 - o.immunity * 0.9)) {
      o.infection = 400 + rng.int(0, 300);
      sim.infectionsPeriod++;
    }
    const hostile = atWarTribe && o.tribeId >= 0 && o.tribeId !== c.tribeId && sim.civ.atWar(c.tribeId, o.tribeId);
    if (o.speciesId !== c.speciesId || hostile) {
      // Predators are stealthy: prey notice them late, and sleeping prey later still.
      const detect = perc * (c.resting ? 0.25 : 0.5);
      if ((isThreat(o, c) || (hostile && o.job === 'raid')) && d2 < threatD2 && d2 < detect * detect) { threat = o; threatD2 = d2; }
      if (meatPref && canPrey(sim, c, o, hunger)) {
        const s = o.effSize / (1 + Math.sqrt(d2)) * (o.age < o.maturity ? 1.4 : 1);
        if (s > preyScore) { preyScore = s; prey = o; }
      }
    } else {
      same++; sx += o.x; sy += o.y;
      if (canMate && o.sex !== c.sex && o.mature && o.cooldown === 0 && o.energy > o.maxEnergy * 0.45 && !isKin(c, o) &&
        geneticDistance(c.genome, o.genome) < MATE_MAX_DISTANCE) {
        const s = (o.id === c.mateId ? 3 : 1) / (1 + Math.sqrt(d2));
        if (s > mateScore) { mateScore = s; mate = o; }
      }
      if (same <= 12 && d2 > 4) {
        const r = c.relations.length ? c.relation(o.id) : undefined;
        const fs = (r ? 1 + r.affinity : 0.5) / (1 + Math.sqrt(d2));
        if (fs > friendScore) { friendScore = fs; friend = o; }
      }
    }
  }
  if (threat) {
    // Is one of my young near the threat?
    for (const cid of c.children) {
      const ch = sim.byId.get(cid);
      if (ch && ch.alive && !ch.mature && Math.abs(ch.x - threat.x) + Math.abs(ch.y - threat.y) < 5) { childInDanger = true; break; }
    }
  }

  // ---- Score options ----
  let best = 'explore' as Action;
  let bs = 0.3 + c.curiosity * 0.5 + rng.next() * 0.2;

  const mother = !c.mature && c.age < c.maturity * 0.65 ? sim.byId.get(c.motherId) : undefined;
  if (mother && mother.alive) { const v = 2.2; if (v > bs) { bs = v; best = 'follow'; } }
  if (threat) {
    const prox = 1 - Math.sqrt(threatD2) / Math.max(1, perc);
    const strongEnough = c.strength * (c.tribeId >= 0 ? sim.civ.combatBonus(c) : 1) > threat.strength * 0.9;
    { const v = 2.5 + prox * 5 - c.aggression * 2 - (strongEnough ? 1.5 : 0); if (v > bs) { bs = v; best = 'flee'; } }
    if (childInDanger || (c.job === 'guard' && c.tribeId >= 0)) { const v = 3 + c.aggression * 3 + (strongEnough ? 2 : 0); if (v > bs) { bs = v; best = 'defend'; } }
  }
  { const v = hunger * 3 + hunger * hunger * 3 + (hunger > 0.65 ? 2.5 : 0); if (v > bs) { bs = v; best = 'graze'; } }
  { const v = thirst * 3 + thirst * thirst * 3 + (thirst > 0.6 ? 3 : 0); if (v > bs) { bs = v; best = 'drink'; } }
  if (canMate) { const v = mate ? 1.6 + c.energy / c.maxEnergy : 0.85; if (v > bs) { bs = v; best = 'mate'; } }
  if (restTime) { const v = 1.6; if (v > bs) { bs = v; best = 'rest'; } }
  if (c.stress > 6 || c.storm > 0.5) { const v = 1.2 + c.stress * 0.1 + c.storm; if (v > bs) { bs = v; best = 'rest'; } }
  { const v = c.sociability * (same < 3 ? 1.1 : 0.2); if (v > bs) { bs = v; best = 'socialize'; } }
  if (c.tribeId >= 0 && !restTime && c.mature && !group) { const v = 1.1; if (v > bs) { bs = v; best = 'work'; } }
  // Travellers keep walking (eating what they find on the way) unless hunger or thirst become serious.
  if (group && !restTime) { const v = 3.1; if (v > bs) { bs = v; best = 'migrate'; } }

  if (best !== c.action) c.actionTicks = 0;
  c.sprint = false;
  if (best !== 'work') { c.job = c.tribeId >= 0 ? c.job : null; }

  switch (best as Action) {
    case 'follow': {
      c.action = 'follow';
      c.targetId = mother!.id;
      c.goal = `Following ${mother!.name}`;
      break;
    }
    case 'flee': {
      const d = Math.sqrt(threatD2) || 1;
      const ax = (c.x - threat!.x) / d, ay = (c.y - threat!.y) / d;
      c.action = 'flee';
      c.tx = c.x + ax * c.perception;
      c.ty = c.y + ay * c.perception;
      c.sprint = true;
      c.decideIn = 6;
      c.goal = `Fleeing from ${threat!.name} the ${speciesLabel(sim, threat!.speciesId)}`;
      if (tick - c.dangerTick > 600) c.remember(tick, 'danger', `Escaped ${threat!.name}, a ${speciesLabel(sim, threat!.speciesId)}`);
      c.dangerX = threat!.x; c.dangerY = threat!.y; c.dangerTick = tick;
      // Alarm call: social herd-mates nearby bolt too.
      if (c.sociability > 0.4) {
        for (let k = 0; k < n; k++) {
          const o = nb[k];
          if (o.speciesId !== c.speciesId || o.action === 'flee' || o.sociability < 0.4) continue;
          if (o.resting || Math.abs(o.x - c.x) + Math.abs(o.y - c.y) > 4) continue;
          o.action = 'flee';
          o.tx = o.x + ax * o.perception; o.ty = o.y + ay * o.perception;
          o.sprint = true; o.actionTicks = 0; o.decideIn = 12;
          o.goal = `Bolting at ${c.name}'s alarm call`;
        }
      }
      break;
    }
    case 'defend': {
      c.action = 'hunt';
      c.targetId = threat!.id;
      c.sprint = true;
      c.goal = childInDanger ? `Defending offspring from ${threat!.name}` : `Defending the tribe from ${threat!.name}`;
      break;
    }
    case 'graze':
      planEat(sim, c, prey, hunger);
      break;
    case 'drink':
      planDrink(sim, c);
      break;
    case 'mate': {
      if (mate) {
        c.action = 'mate';
        c.targetId = mate.id;
        c.goal = `Courting ${mate.name}`;
      } else if (same > 0) {
        c.action = 'socialize';
        c.tx = sx / same; c.ty = sy / same;
        c.targetId = -1;
        c.goal = 'Looking for a mate';
      } else planExplore(sim, c, 'Searching far and wide for a mate');
      break;
    }
    case 'rest':
      planRest(sim, c, same > 0 ? sx / same : c.x, same > 0 ? sy / same : c.y);
      break;
    case 'socialize': {
      c.action = 'socialize';
      if (friend) { c.targetId = friend.id; c.goal = `Spending time with ${friend.name}`; }
      else if (same > 0) { c.targetId = -1; c.tx = sx / same; c.ty = sy / same; c.goal = 'Rejoining the herd'; }
      else planExplore(sim, c, 'Looking for others of its kind');
      break;
    }
    case 'work':
      if (!sim.civ.planWork(sim, c)) planExplore(sim, c, 'Wandering near the settlement');
      break;
    case 'migrate': {
      c.action = 'migrate';
      c.targetId = -1;
      const dest = group!.destId >= 0 ? sim.civ.settlementById.get(group!.destId)?.name : undefined;
      c.goal = group!.kind === 'refugee' ? `Fleeing as a refugee to ${dest ?? 'safety'}`
        : group!.kind === 'colonist' ? `Travelling to found a new settlement` : `Migrating to ${dest ?? 'a new home'}`;
      break;
    }
    default:
      if (c.action === 'explore' && c.actionTicks < 200 && Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 1) break;
      planExplore(sim, c, null);
  }
  // Settled states re-think less often; anything that attacks them still wakes them at once.
  if (!threat) {
    if (c.action === 'rest' && restTime) c.decideIn += 12;
    else if ((c.action === 'graze' && c.tx === c.x && c.ty === c.y) || c.action === 'explore' || c.action === 'return') c.decideIn += 5;
    else if (c.action === 'drink' && c.targetId === -3) c.decideIn += 6;
  }
}

function planEat(sim: Simulation, c: Creature, prey: Creature | null, hunger: number): void {
  const w = sim.world, rng = sim.rng;
  // Tribe granary.
  if (c.tribeId >= 0 && c.homeId >= 0) {
    const s = sim.civ.settlement(c.homeId);
    if (s && s.stock.food > 2) {
      const d = dist2d(s.x - c.x, s.y - c.y);
      if (d < 30 && (hunger > 0.3 || d < 8)) {
        c.action = 'eat_store';
        c.tx = s.x + rng.range(-1, 1); c.ty = s.y + rng.range(-1, 1);
        c.goal = `Eating from the stores of ${s.name}`;
        return;
      }
    }
  }
  const meatPref = c.meatEff > c.herbEff * 0.75;
  if (meatPref || (c.meatEff > 0.3 && prey)) {
    const carcass = sim.nearestCarcass(c.x, c.y, c.perception);
    if (carcass) {
      c.action = 'scavenge';
      c.targetId = carcass.id;
      c.tx = carcass.x; c.ty = carcass.y;
      c.goal = 'Scavenging a carcass';
      return;
    }
    if (prey) {
      c.action = 'hunt';
      c.targetId = prey.id;
      c.sprint = true;
      c.goal = `Hunting ${prey.name} the ${speciesLabel(sim, prey.speciesId)}`;
      return;
    }
  }
  if (c.herbEff > 0.2) {
    const tile = w.tileAt(c.x, c.y);
    if (w.veg[tile] > 2) {
      c.action = 'graze';
      c.tx = c.x; c.ty = c.y;
      c.goal = `Grazing in the ${BIOMES[w.biome[tile]].name}`;
      return;
    }
    let bx = -1, by = -1, bscore = 0.9;
    for (let k = 0; k < 10; k++) {
      const a = rng.next() * Math.PI * 2, r = rng.next() * c.perception;
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      if (!w.inBounds(x, y)) continue;
      const i = w.tileAt(x, y);
      if (w.moveMult(i, c.swim, false) === 0) continue;
      let s = w.veg[i] - r * 0.12;
      if (sim.tick - c.dangerTick < 800 && Math.abs(x - c.dangerX) + Math.abs(y - c.dangerY) < 6) s -= 3;
      if (s > bscore) { bscore = s; bx = x; by = y; }
    }
    if (c.foodX >= 0) {
      const i = w.tileAt(c.foodX, c.foodY);
      const s = w.veg[i] - dist2d(c.foodX - c.x, c.foodY - c.y) * 0.06;
      if (s > bscore) { bscore = s; bx = c.foodX; by = c.foodY; }
    }
    if (bx >= 0) {
      c.action = 'graze';
      c.tx = bx; c.ty = by;
      c.goal = `Heading to better grazing`;
      return;
    }
    // Chunk-level food gradient: smell richer land further away.
    const ccx = Math.floor(c.x / CHUNK), ccy = Math.floor(c.y / CHUNK);
    const R = Math.ceil(c.perception / CHUNK) + 1;
    let best = -1, bestS = -Infinity;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = ccx + dx, y = ccy + dy;
        if (x < 0 || y < 0 || x >= w.chunksX || y >= w.chunksY) continue;
        const s = w.chunkFood[y * w.chunksX + x] - dist2d(dx, dy) * 0.25 + rng.next() * 0.2;
        if (s > bestS) { bestS = s; best = y * w.chunksX + x; }
      }
    }
    if (best >= 0 && bestS > 0.3) {
      c.action = 'graze';
      c.tx = ((best % w.chunksX) + rng.next()) * CHUNK;
      c.ty = (Math.floor(best / w.chunksX) + rng.next()) * CHUNK;
      c.goal = 'Migrating toward greener land';
      return;
    }
    planExplore(sim, c, 'Searching desperately for food');
    return;
  }
  // Pure carnivore with nothing in sight: roam toward crowded areas.
  const sp = sim.spatial;
  const ci = sp.cellIndex(c.x, c.y);
  const cx = ci % sp.cols, cy = Math.floor(ci / sp.cols);
  // Follow the scent of prey: pick the nearby cell with the most edible creatures.
  let bestCell = ci, bestN = -1;
  for (let dy = -5; dy <= 5; dy += 2) {
    for (let dx = -5; dx <= 5; dx += 2) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= sp.cols || y >= sp.rows) continue;
      const ci = y * sp.cols + x;
      let cnt = 0;
      for (let k = sp.cellStart[ci], e = sp.cellStart[ci + 1]; k < e; k++) {
        const o = sp.refs[k];
        if (o.speciesId !== c.speciesId && o.meatEff < 0.5 && o.effSize <= c.effSize * 1.7) cnt++;
      }
      const sc = cnt / (1 + dist2d(dx, dy) * 0.4) + rng.next();
      if (sc > bestN) { bestN = sc; bestCell = y * sp.cols + x; }
    }
  }
  c.action = 'explore';
  c.tx = ((bestCell % sp.cols) + rng.next()) * sp.cell;
  c.ty = (Math.floor(bestCell / sp.cols) + rng.next()) * sp.cell;
  c.goal = 'Stalking the land for prey';
}

function planDrink(sim: Simulation, c: Creature): void {
  const w = sim.world;
  const tile = w.tileAt(c.x, c.y);
  c.action = 'drink';
  if (w.waterDist[tile] <= 1) {
    c.targetId = -3; // at water
    c.goal = 'Drinking';
    return;
  }
  if (w.waterDist[tile] <= c.perception * 1.8) {
    c.targetId = -2; // follow the scent of water downhill on the distance field
    c.goal = 'Following the scent of water';
    return;
  }
  c.targetId = -1;
  if (c.waterX >= 0) {
    c.tx = c.waterX; c.ty = c.waterY;
    c.goal = 'Returning to a remembered watering hole';
    return;
  }
  const spot = c.tribeId >= 0 ? sim.civ.knownWater(c) : null;
  if (spot) {
    c.tx = spot.x; c.ty = spot.y;
    c.goal = 'Heading to water the tribe knows of';
    return;
  }
  planExplore(sim, c, 'Searching for water');
  c.action = 'drink';
}

function planRest(sim: Simulation, c: Creature, gx: number, gy: number): void {
  const w = sim.world;
  c.targetId = -1;
  if (c.tribeId >= 0 && c.homeId >= 0) {
    const s = sim.civ.settlement(c.homeId);
    if (s) {
      const d = dist2d(s.x - c.x, s.y - c.y);
      if (d > 2.5) {
        c.action = 'return';
        c.tx = s.x + sim.rng.range(-1.5, 1.5); c.ty = s.y + sim.rng.range(-1.5, 1.5);
        c.goal = `Heading home to ${s.name}`;
        return;
      }
      c.action = 'rest';
      c.tx = c.x; c.ty = c.y;
      c.goal = `Resting in ${s.name}`;
      return;
    }
  }
  if (c.stress > 6 || c.storm > 0.5) {
    let bx = -1, by = -1, bs = BIOMES[w.biome[w.tileAt(c.x, c.y)]].shelter;
    for (let k = 0; k < 12; k++) {
      const a = sim.rng.next() * Math.PI * 2, r = sim.rng.next() * c.perception;
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      if (!w.inBounds(x, y)) continue;
      const i = w.tileAt(x, y);
      if (w.moveMult(i, c.swim, false) === 0) continue;
      const s = BIOMES[w.biome[i]].shelter - r * 0.02;
      if (s > bs + 0.1) { bs = s; bx = x; by = y; }
    }
    c.action = 'rest';
    if (bx >= 0) { c.tx = bx; c.ty = by; c.goal = c.storm > 0.5 ? 'Sheltering from the storm' : 'Seeking shelter from the cold'; }
    else { c.tx = c.x; c.ty = c.y; c.goal = 'Huddling against the elements'; }
    return;
  }
  c.action = 'rest';
  if (c.sociability > 0.5 && dist2d(gx - c.x, gy - c.y) > 1.5) {
    c.tx = gx; c.ty = gy;
    c.goal = 'Bedding down with the herd';
  } else {
    c.tx = c.x; c.ty = c.y;
    c.goal = c.nocturnal ? 'Sleeping through the day' : 'Sleeping';
  }
}

export function planExplore(sim: Simulation, c: Creature, goal: string | null): void {
  const w = sim.world, rng = sim.rng;
  c.action = 'explore';
  c.targetId = -1;
  for (let k = 0; k < 6; k++) {
    let a = rng.next() * Math.PI * 2;
    if (c.curiosity < 0.5 && k < 3) {
      // Homebodies drift back toward familiar ground.
      const hx = c.homeId >= 0 ? sim.civ.settlement(c.homeId)?.x ?? c.birthX : c.birthX;
      const hy = c.homeId >= 0 ? sim.civ.settlement(c.homeId)?.y ?? c.birthY : c.birthY;
      if (dist2d(hx - c.x, hy - c.y) > 20) a = Math.atan2(hy - c.y, hx - c.x) + rng.range(-0.8, 0.8);
    }
    const r = c.perception * rng.range(1.2, 3.5) * (0.6 + c.curiosity);
    const x = Math.min(w.width - 1, Math.max(0, c.x + Math.cos(a) * r));
    const y = Math.min(w.height - 1, Math.max(0, c.y + Math.sin(a) * r));
    if (w.moveMult(w.tileAt(x, y), c.swim, false) > 0 || k === 5) {
      c.tx = x; c.ty = y;
      break;
    }
  }
  c.goal = goal ?? (c.curiosity > 0.6 ? 'Exploring the unknown' : 'Wandering');
}

/** Move toward a point; returns remaining distance. */
export function moveToward(sim: Simulation, c: Creature, tx: number, ty: number, mult = 1): number {
  const dx = tx - c.x, dy = ty - c.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.05) return d;
  const w = sim.world;
  const sail = c.tribeId >= 0 && sim.civ.hasTech(c.tribeId, 'sailing');
  const here = w.moveMult(w.tileAt(c.x, c.y), c.swim, sail) || 0.35;
  const ageF = c.age > c.lifespan * 0.85 ? 0.75 : c.mature ? 1 : 0.85;
  let burst = 1;
  if (c.sprint && c.stamina > 0) {
    burst = c.action === 'hunt' ? 1.75 : 1.4;
    c.stamina -= 1 / 70;
  } else if (c.stamina < 1) c.stamina = Math.min(1, c.stamina + 1 / 350);
  const wound = 0.55 + 0.45 * (c.health / c.maxHealth);
  let sp = c.speed * mult * here * burst * ageF * wound * (c.storm > 0 ? 1 - 0.3 * c.storm : 1);
  if (sp > d) sp = d;
  const desired = Math.atan2(dy, dx);
  let straight = d < 2;
  if (straight) c.heading = desired;
  else {
    let diff = desired - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > 0.5) c.heading += 0.5;
    else if (diff < -0.5) c.heading -= 0.5;
    else { c.heading = desired; straight = true; }
  }
  for (let k = 0; k < MOVE_OFFSETS.length; k++) {
    let nx: number, ny: number;
    if (k === 0 && straight) {
      // Heading equals the target direction: no trig needed.
      nx = c.x + (dx / d) * sp; ny = c.y + (dy / d) * sp;
    } else {
      const h = c.heading + MOVE_OFFSETS[k];
      nx = c.x + Math.cos(h) * sp; ny = c.y + Math.sin(h) * sp;
    }
    if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
    if (w.moveMult(w.tileAt(nx, ny), c.swim, sail) > 0) {
      c.x = nx; c.y = ny;
      if (k > 0) c.heading += MOVE_OFFSETS[k];
      c.distance += sp;
      const rel = sp / 0.1;
      c.energy -= MOVE_COST * c.effSize * rel * rel;
      return Math.max(0, d - sp);
    }
  }
  // Boxed in: pick somewhere else.
  c.decideIn = 0;
  c.action = 'wander';
  c.tx = c.x + sim.rng.range(-4, 4);
  c.ty = c.y + sim.rng.range(-4, 4);
  return d;
}

function eatPlants(sim: Simulation, c: Creature): boolean {
  const w = sim.world;
  const i = w.tileAt(c.x, c.y);
  const v = w.veg[i];
  if (v < VEG_RESERVE + 0.1) return false;
  const bite = Math.min(v - VEG_RESERVE, BITE * c.effSize);
  w.veg[i] = v - bite;
  c.energy = Math.min(c.maxEnergy, c.energy + bite * PLANT_ENERGY * c.herbEff);
  sim.foodEatenPeriod += bite;
  if (v > 5 && c.foodX < 0) {
    c.foodX = c.x; c.foodY = c.y;
  }
  return true;
}

/** Execute the current action for one tick. */
export function act(sim: Simulation, c: Creature): void {
  c.actionTicks++;
  c.resting = false;
  const w = sim.world;
  switch (c.action) {
    case 'rest': {
      if (Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.7) moveToward(sim, c, c.tx, c.ty, 0.7);
      else c.resting = true;
      return;
    }
    case 'return': {
      if (moveToward(sim, c, c.tx, c.ty) < 0.6) { c.action = 'rest'; c.resting = true; }
      return;
    }
    case 'graze': {
      const d = Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y);
      if (d < 0.8) {
        if (!eatPlants(sim, c) || c.energy >= c.maxEnergy * 0.97) c.decideIn = 0;
      } else moveToward(sim, c, c.tx, c.ty);
      return;
    }
    case 'follow': {
      const m = sim.byId.get(c.targetId);
      if (!m || !m.alive) { c.decideIn = 0; return; }
      const d = dist2d(m.x - c.x, m.y - c.y);
      if (d > 1.6) moveToward(sim, c, m.x, m.y, 1.1);
      else {
        c.resting = m.resting;
        if (c.herbEff > 0.2 && c.energy < c.maxEnergy * 0.9) eatPlants(sim, c);
        if (c.energy < c.maxEnergy * 0.5 && m.energy > m.maxEnergy * 0.5) {
          // Parental feeding.
          m.energy -= 0.15; c.energy += 0.13;
        }
      }
      return;
    }
    case 'hunt': {
      if (c.targetId < 0) { c.decideIn = 0; return; }
      const p = sim.byId.get(c.targetId);
      if (!p || !p.alive) { c.decideIn = 0; return; }
      const d = dist2d(p.x - c.x, p.y - c.y);
      if (d > c.perception * 1.6 || c.actionTicks > 160) { c.decideIn = 0; return; }
      const reach = 0.5 + (c.effSize + p.effSize) * 0.25;
      if (d <= reach) {
        if (c.attackCd === 0) attack(sim, c, p);
      } else {
        // Stalk quietly, then pounce once close or once the prey bolts.
        c.sprint = d < 3.5 || p.action === 'flee';
        moveToward(sim, c, p.x, p.y, c.sprint ? 1 : 0.85);
      }
      return;
    }
    case 'scavenge': {
      const k = sim.carcassById(c.targetId);
      if (!k) { c.decideIn = 0; return; }
      if (dist2d(k.x - c.x, k.y - c.y) < 0.9) {
        const bite = Math.min(k.meat, 1.2 * c.effSize);
        k.meat -= bite;
        c.energy = Math.min(c.maxEnergy, c.energy + bite * MEAT_ENERGY * Math.max(0.15, c.meatEff));
        if (c.energy >= c.maxEnergy * 0.97 || k.meat <= 0) c.decideIn = 0;
      } else moveToward(sim, c, k.x, k.y);
      return;
    }
    case 'drink': {
      const i = w.tileAt(c.x, c.y);
      if (w.waterDist[i] <= 1) {
        c.hydration = Math.min(1, c.hydration + DRINK_RATE);
        if (c.waterX < 0 || dist2d(c.waterX - c.x, c.waterY - c.y) > 15) {
          if (c.waterX < 0) c.remember(sim.tick, 'water', `Found fresh water in the ${BIOMES[w.biome[i]].name}`);
          c.waterX = c.x; c.waterY = c.y;
          if (c.tribeId >= 0) sim.civ.shareWater(c);
        }
        if (c.hydration >= 0.98) c.decideIn = 0;
        c.goal = 'Drinking';
        return;
      }
      if (c.targetId === -2) {
        // Descend the fresh-water distance field.
        const x0 = Math.floor(c.x), y0 = Math.floor(c.y);
        let best = w.waterDist[i], bx = c.x, by = c.y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = x0 + dx, y = y0 + dy;
            if (!w.inBounds(x, y)) continue;
            const j = w.idx(x, y);
            if (w.waterDist[j] < best && (w.isLand(j) || w.waterDist[j] === 0)) { best = w.waterDist[j]; bx = x + 0.5; by = y + 0.5; }
          }
        }
        if (bx === c.x && by === c.y) { c.decideIn = 0; c.targetId = -1; planExplore(sim, c, 'Searching for water'); c.action = 'drink'; return; }
        moveToward(sim, c, bx, by);
        return;
      }
      if (moveToward(sim, c, c.tx, c.ty) < 0.8) {
        if (c.waterX >= 0 && dist2d(c.waterX - c.x, c.waterY - c.y) < 1.5 && w.waterDist[w.tileAt(c.x, c.y)] > 2) {
          c.waterX = -1; c.waterY = -1; // that spot dried up or was misremembered
        }
        c.decideIn = 0;
      }
      return;
    }
    case 'mate': {
      const p = sim.byId.get(c.targetId);
      if (!p || !p.alive || p.cooldown > 0 || c.cooldown > 0) { c.decideIn = 0; return; }
      const d = dist2d(p.x - c.x, p.y - c.y);
      if (d < 1.2) {
        sim.tryMate(c, p);
        c.decideIn = 0;
      } else moveToward(sim, c, p.x, p.y);
      return;
    }
    case 'flee': {
      moveToward(sim, c, c.tx, c.ty);
      if (c.actionTicks > 45) c.decideIn = 0;
      return;
    }
    case 'socialize': {
      let tx = c.tx, ty = c.ty;
      const f = c.targetId >= 0 ? sim.byId.get(c.targetId) : undefined;
      if (c.targetId >= 0) {
        if (!f || !f.alive) { c.decideIn = 0; return; }
        tx = f.x; ty = f.y;
      }
      const d = dist2d(tx - c.x, ty - c.y);
      if (d > 1.8) moveToward(sim, c, tx, ty, 0.8);
      else {
        if (f && (sim.tick + c.id) % 20 === 0) {
          const kind = c.relation(f.id)?.kind ?? 'friend';
          c.addRelation(f.id, kind, 0.08);
          f.addRelation(c.id, f.relation(c.id)?.kind ?? 'friend', 0.08);
        }
        if (c.herbEff > 0.2) eatPlants(sim, c);
        if (c.actionTicks > 40) c.decideIn = 0;
      }
      return;
    }
    case 'eat_store': {
      if (moveToward(sim, c, c.tx, c.ty) < 1.2) {
        sim.civ.eatFromStore(c);
        c.decideIn = 0;
      }
      return;
    }
    case 'work':
      sim.civ.actWork(sim, c);
      return;
    case 'migrate': {
      const g = c.migrationId >= 0 ? sim.civ.group(c.migrationId) : undefined;
      if (!g) { c.decideIn = 0; return; }
      const p = migrantTarget(sim, g, c);
      moveToward(sim, c, p.x, p.y);
      if (c.herbEff > 0.3 && c.energy < c.maxEnergy * 0.85 && (sim.tick + c.id) % 2 === 0) eatPlants(sim, c);
      if (c.hydration < 0.7 && sim.world.waterDist[sim.world.tileAt(c.x, c.y)] <= 1) c.hydration = Math.min(1, c.hydration + 0.02);
      return;
    }
    default: {
      if (moveToward(sim, c, c.tx, c.ty, c.action === 'explore' ? 0.85 : 0.6) < 0.6) c.decideIn = 0;
      // Opportunistic snacking while travelling.
      if (c.herbEff > 0.3 && c.energy < c.maxEnergy * 0.8 && (sim.tick + c.id) % 3 === 0) eatPlants(sim, c);
    }
  }
}

/** Physical attack between two creatures. */
export function attack(sim: Simulation, a: Creature, d: Creature): void {
  const rng = sim.rng;
  a.attackCd = 6;
  const atk = a.strength * 30 * rng.range(0.6, 1.25) * sim.civ.combatBonus(a);
  const def = sim.civ.defenseBonus(d);
  d.health -= atk / def;
  d.lastAttacker = a.id;
  d.lastDamage = `killed by ${a.name} (${speciesLabel(sim, a.speciesId)})`;
  if (d.health <= 0) {
    sim.kill(d, d.lastDamage, a);
    return;
  }
  const r = d.relation(a.id);
  if (!r) d.addRelation(a.id, 'rival', -0.5); else r.affinity = Math.max(-1, r.affinity - 0.3);
  // Tribe-mates rally to defend one of their own.
  if (d.tribeId >= 0 && a.tribeId !== d.tribeId) {
    const n = sim.spatial.query(d.x, d.y, 7, rally, 24, d);
    for (let k = 0; k < n; k++) {
      const o = rally[k];
      if (o.tribeId !== d.tribeId || !o.mature || o.health < o.maxHealth * 0.4 || o.action === 'hunt') continue;
      o.action = 'hunt';
      o.targetId = a.id;
      o.sprint = true;
      o.actionTicks = 0;
      o.decideIn = 40;
      o.goal = `Rushing to defend ${d.name} from ${a.name}`;
    }
  }
  // Defender reacts: fight back or flee.
  if (d.aggression > 0.55 && d.strength > a.strength * 0.7) {
    a.health -= d.strength * 18 * rng.range(0.5, 1.1) * sim.civ.combatBonus(d) / sim.civ.defenseBonus(a);
    a.lastDamage = `killed by ${d.name} (${speciesLabel(sim, d.speciesId)}) in self-defence`;
    if (a.health <= 0) sim.kill(a, a.lastDamage, d);
  } else if (d.action !== 'flee') {
    const dist = dist2d(d.x - a.x, d.y - a.y) || 1;
    d.action = 'flee';
    d.tx = d.x + ((d.x - a.x) / dist) * d.perception;
    d.ty = d.y + ((d.y - a.y) / dist) * d.perception;
    d.sprint = true;
    d.actionTicks = 0;
    d.decideIn = 20;
    d.goal = `Fleeing from ${a.name}`;
    if (sim.tick - d.dangerTick > 300) d.remember(sim.tick, 'attacked', `Wounded by ${a.name} the ${speciesLabel(sim, a.speciesId)}`);
    d.dangerX = a.x; d.dangerY = a.y; d.dangerTick = sim.tick;
  }
}

export { REGEN_RATE };
