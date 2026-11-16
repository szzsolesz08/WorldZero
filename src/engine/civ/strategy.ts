/**
 * Civilization-level strategy: competing goals, player policies, stability, rebellion and
 * fragmentation, capital succession, expansion by colonists, decline and recovery.
 * Runs on a slow schedule (every 10 civ passes per tribe).
 */
import type { Simulation } from '../simulation';
import type { Creature } from '../creatures/creature';
import type { CivManager, Tribe } from './civilization';
import { Settlement, currentEra, settlementEvent, housingOf, structurePoints, TIER_NAMES } from './settlements';
import { launchColonists, MIN_VIABLE } from './migration';
import { tribeName } from '../creatures/names';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants';
import { POLICY_KEYS, type GoalId, type PolicyKey } from '../types';
import { dist2d } from '../mathutil';

export const GOAL_LABEL: Record<GoalId, string> = {
  grow: 'Grow the population', food_security: 'Secure food supplies', expand: 'Expand and colonize', research: 'Advance knowledge',
  trade: 'Build trade', defend: 'Defend the borders', conquest: 'Conquer rivals', alliance: 'Seek alliances',
  recover: 'Recover and rebuild', stability: 'Restore order',
};

export const POLICY_LABEL: Record<PolicyKey, string> = {
  expansion: 'Expansion', agriculture: 'Agriculture', trade: 'Trade', research: 'Research', diplomacy: 'Diplomacy',
  military: 'Military', conservation: 'Conservation', stability: 'Internal stability',
};

export const POLICY_DELAY = TICKS_PER_DAY * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function defaultPolicies(): Record<PolicyKey, number> {
  return Object.fromEntries(POLICY_KEYS.map((k) => [k, 0])) as Record<PolicyKey, number>;
}

/** Effective policy value in [-1, 1]. */
export function pol(t: Tribe | undefined, k: PolicyKey): number {
  return t ? t.policies[k] ?? 0 : 0;
}

/** Weight of a goal: 1 for the top priority, 0.7 / 0.5 for the next, 0 if not pursued. */
export function goalW(t: Tribe | undefined, g: GoalId): number {
  if (!t) return 0;
  const i = t.goals.indexOf(g);
  return i < 0 ? 0 : [1, 0.7, 0.5][i] ?? 0.4;
}

/** Player command: queue a policy change (it takes effect after an adoption delay). */
export function requestPolicy(sim: Simulation, t: Tribe, key: PolicyKey, value: number): void {
  const v = clamp(Math.round(value), -1, 1);
  t.pendingPolicies = t.pendingPolicies.filter((p) => p.key !== key);
  if (t.policies[key] === v) return;
  t.pendingPolicies.push({ key, value: v, effectiveAt: sim.tick + POLICY_DELAY });
}

function applyPendingPolicies(sim: Simulation, civ: CivManager, t: Tribe): void {
  const due = t.pendingPolicies.filter((p) => p.effectiveAt <= sim.tick);
  if (!due.length) return;
  t.pendingPolicies = t.pendingPolicies.filter((p) => p.effectiveAt > sim.tick);
  for (const p of due) {
    const delta = Math.abs(p.value - (t.policies[p.key] ?? 0));
    t.policies[p.key] = p.value;
    t.stability = clamp(t.stability - 0.04 * delta, 0, 1);
    t.policyHistory.push({ tick: sim.tick, key: p.key, value: p.value });
    if (t.policyHistory.length > 30) t.policyHistory.shift();
    const word = p.value > 0 ? 'prioritized' : p.value < 0 ? 'de-emphasized' : 'returned to a balanced stance on';
    civ.tribeEvent(sim, t, { cat: 'civ', level: 1, title: 'New policy', text: `${t.name} ${word} ${POLICY_LABEL[p.key].toLowerCase()}.` });
  }
}

/** Slow strategic pass for one tribe. */
export function updateStrategy(sim: Simulation, civ: CivManager, t: Tribe): void {
  applyPendingPolicies(sim, civ, t);
  const active = t.settlementIds.map((id) => civ.settlement(id)).filter((s): s is Settlement => !!s);
  checkCapital(sim, civ, t, active);
  updateMetrics(sim, civ, t, active);
  updateStability(sim, civ, t, active);
  chooseGoals(sim, civ, t, active);
  checkDeclineRecovery(sim, civ, t);
  if (active.length >= 2) checkRebellion(sim, civ, t, active);
  if (goalW(t, 'expand') > 0 || pol(t, 'expansion') > 0) tryExpand(sim, civ, t, active);
}

function checkCapital(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  const cap = civ.settlement(t.capitalId);
  if (cap && cap.tribeId === t.id) return;
  if (!active.length) { t.capitalId = -1; return; }
  const next = active.reduce((a, b) => (b.population > a.population ? b : a));
  const hadCapital = t.capitalId >= 0;
  const lostName = civ.settlementById.get(t.capitalId)?.name;
  t.capitalId = next.id;
  if (hadCapital) {
    t.capitalLostTick = sim.tick;
    t.popAtCapitalLoss = t.population;
    t.stability = clamp(t.stability - 0.2, 0, 1);
    const ev = civ.tribeEvent(sim, t, {
      cat: 'civ', level: 2, title: 'Capital lost',
      text: `${t.name} lost ${lostName ?? 'its capital'}; ${next.name} is now the seat of power.`,
      causeId: civ.lastLossEvent.get(t.id),
    });
    t.instabilityCause = ev.id;
  }
}

function updateMetrics(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  let pop = 0, fs = 0;
  for (const s of active) {
    pop += s.population;
    fs += s.population * clamp((s.econ.prosperity + 1) / 2 * 0.5 + clamp(s.econ.reserveDays / 8, 0, 1) * 0.5, 0, 1);
  }
  t.foodSecurity = pop > 0 ? fs / pop : 0.5;
  let mil = 0;
  for (const c of sim.creatures) if (c.tribeId === t.id && c.mature) mil += c.strength;
  t.military = mil * civ.combatBonusFor(t);
  const avgP = active.length ? active.reduce((a, s) => a + s.econ.prosperity, 0) / active.length : 0;
  t.economy = avgP > 0.35 ? 'Prosperous' : avgP > 0.05 ? 'Stable' : avgP > -0.25 ? 'Strained' : 'In crisis';
}

function updateStability(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  const tick = sim.tick;
  const has = (x: string) => t.techs.includes(x);
  const govCap = 2 + (has('governance') ? 2 : 0) + (has('writing') ? 1 : 0) + (has('philosophy') ? 1 : 0) + (t.government === 'Empire' ? 1 : 0);
  const cap = civ.settlement(t.capitalId);
  let distSum = 0;
  for (const s of active) if (cap) distSum += dist2d(s.x - cap.x, s.y - cap.y);
  const avgDist = active.length ? distSum / active.length : 0;
  const factors: [string, number, number | undefined][] = [
    ['hunger', (1 - t.foodSecurity) * 0.35, undefined],
    ['overextension', Math.max(0, active.length - govCap) * 0.06, undefined],
    ['distance', Math.min(0.2, avgDist / (has('writing') ? 140 : 80) * 0.2), undefined],
    ['war', Math.min(0.18, civ.enemiesOf(t.id).length * 0.06), undefined],
    ['loss', tick - t.recentLossTick < TICKS_PER_DAY * 20 ? 0.15 : 0, civ.lastLossEvent.get(t.id)],
    ['succession', tick - t.leaderSince < TICKS_PER_DAY * 6 ? 0.1 : 0, undefined],
    ['capital', tick - t.capitalLostTick < TICKS_PER_DAY * 30 ? 0.2 : 0, t.instabilityCause >= 0 ? t.instabilityCause : undefined],
  ];
  let penalty = 0;
  let worst = factors[0];
  for (const f of factors) { penalty += f[1]; if (f[1] > worst[1]) worst = f; }
  const bonus = 0.08 * pol(t, 'stability') + 0.02 * Math.min(4, t.traditions.length) +
    (['Monarchy', 'Republic', 'Council of Elders'].includes(t.government) ? 0.05 : t.government === 'Empire' ? 0.03 : 0) +
    0.1 * goalW(t, 'stability');
  const target = clamp(0.5 + 0.3 * t.foodSecurity + bonus - penalty, 0, 1);
  t.stability = clamp(t.stability + (target - t.stability) * 0.2, 0, 1);
  t.instability = worst[1] > 0.06 ? worst[0] : '';
  if (worst[2] !== undefined) t.instabilityCause = worst[2];
  else if (worst[0] === 'hunger') {
    // The famine of the worst-off settlement explains the unrest.
    const bad = active.filter((s) => s.lastCause >= 0).sort((a, b) => a.econ.prosperity - b.econ.prosperity)[0];
    if (bad) t.instabilityCause = bad.lastCause;
  }
  if (t.stability < 0.3) { if (t.lowStabilitySince < 0) t.lowStabilitySince = tick; }
  else if (t.stability > 0.38) t.lowStabilitySince = -1;
}

function chooseGoals(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  const rng = sim.rng;
  const c = t.culture;
  let res = 0, housing = 0;
  for (const s of active) { res += s.population; housing += housingOf(s); }
  const crowding = housing > 0 ? res / housing : 1;
  const enemies = civ.enemiesOf(t.id);
  let threat = Math.min(1, enemies.length * 0.4);
  for (const s of active) threat = Math.max(threat, 1 - s.econ.security);
  const leader = sim.byId.get(t.leaderId);
  const la = leader ? leader.aggression - 0.5 : 0, lc = leader ? leader.curiosity - 0.5 : 0;
  const crisisCount = active.filter((s) => s.state === 'crisis' || s.state === 'declining').length;
  const recentLoss = sim.tick - t.recentLossTick < TICKS_PER_DAY * 30 ? 1 : 0;
  const weakNeighbor = civ.weakerNeighbor(sim, t) ? 0.3 : 0;
  const u: Record<GoalId, number> = {
    grow: (1 - Math.min(1, crowding)) * 0.6 + c.agrarian * 0.2,
    food_security: (1 - t.foodSecurity) * 1.3 + 0.2 * pol(t, 'agriculture'),
    expand: Math.max(0, crowding - 0.55) * 0.9 + (t.population >= 20 ? 0.25 : 0) + 0.4 * pol(t, 'expansion') + 0.15 * lc - 0.3 * Math.max(0, pol(t, 'conservation')),
    research: c.scholarship * 0.6 + 0.35 * pol(t, 'research') + 0.1 * lc,
    trade: (t.techs.includes('trade') && civ.alliesOf(t.id).length ? 0.4 : 0.05) + c.openness * 0.4 + 0.4 * pol(t, 'trade'),
    defend: threat * 1.1 + c.militarism * 0.2 + 0.2 * pol(t, 'military'),
    conquest: c.militarism * 0.55 + weakNeighbor + (t.government === 'Empire' || t.government === 'Monarchy' ? 0.15 : 0) + 0.35 * pol(t, 'military') + 0.2 * la - (t.foodSecurity < 0.4 ? 0.3 : 0),
    alliance: c.openness * 0.4 + threat * 0.35 + 0.4 * pol(t, 'diplomacy'),
    recover: crisisCount * 0.35 + recentLoss * 0.5,
    stability: (1 - t.stability) * 1.2 + 0.3 * pol(t, 'stability'),
  };
  const ranked = (Object.keys(u) as GoalId[]).map((g) => [g, u[g] + rng.next() * 0.08] as const).sort((a, b) => b[1] - a[1]);
  let next = ranked.slice(0, 3).map((r) => r[0]);
  const prevTop = t.goals[0];
  // Hysteresis: a priority is only replaced by one that is clearly more pressing.
  if (prevTop && next[0] !== prevTop && u[prevTop] + 0.12 >= ranked[0][1]) next = [prevTop, ...next.filter((g) => g !== prevTop)].slice(0, 3);
  t.goals = next;
  if (prevTop && prevTop !== next[0] && t.population >= 15 && sim.tick - t.lastGoalEvent > TICKS_PER_DAY * 20) {
    t.lastGoalEvent = sim.tick;
    civ.tribeEvent(sim, t, { cat: 'civ', level: 1, title: 'A new course', text: `${t.name} turned its efforts to a new priority: ${GOAL_LABEL[next[0]].toLowerCase()}.` });
  }
}

function checkDeclineRecovery(sim: Simulation, civ: CivManager, t: Tribe): void {
  if (t.peak < 15) return;
  if (!t.declining && t.population < t.peak * 0.5) {
    t.declining = true;
    t.declinePeak = t.peak;
    t.lowPoint = t.population;
    civ.counters.declines++;
    civ.tribeEvent(sim, t, {
      cat: 'civ', level: 2, title: `${t.name} in decline`,
      text: `${t.name} has fallen to ${t.population} people, half its peak of ${t.peak}${t.instability ? `, weakened by ${t.instability}` : ''}.`,
      causeId: t.instabilityCause >= 0 ? t.instabilityCause : civ.lastLossEvent.get(t.id),
    });
  } else if (t.declining) {
    t.lowPoint = Math.min(t.lowPoint, t.population);
    if (t.population >= Math.max(t.lowPoint * 1.6, t.declinePeak * 0.75)) {
      t.declining = false;
      civ.counters.recoveries++;
      civ.tribeEvent(sim, t, {
        cat: 'civ', level: 2, title: `${t.name} recovers`,
        text: `${t.name} has recovered from its decline, growing from ${t.lowPoint} back to ${t.population} people.`,
      });
    }
  }
}

function checkRebellion(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  const tick = sim.tick;
  if (t.lowStabilitySince < 0 || tick - t.lowStabilitySince < TICKS_PER_DAY * 8) return;
  if (tick - t.lastSecession < TICKS_PER_DAY * 20) return;
  const cap = civ.settlement(t.capitalId);
  let best: Settlement | null = null, bs = -Infinity;
  for (const s of active) {
    if (s.id === t.capitalId || s.population < MIN_VIABLE) continue;
    const d = cap ? dist2d(s.x - cap.x, s.y - cap.y) : 30;
    const score = d / 50 + s.econ.pressure + (1 - s.econ.security) * 0.3 + sim.rng.next() * 0.2;
    if (score > bs) { bs = score; best = s; }
  }
  if (!best) return;
  secede(sim, civ, t, best);
}

/** A settlement breaks away and forms a successor civilization. */
export function secede(sim: Simulation, civ: CivManager, t: Tribe, s: Settlement): Tribe {
  const rng = sim.rng;
  const tick = sim.tick;
  const residents = (civ.residents.get(s.id) ?? []).filter((c) => c.alive && c.homeId === s.id && c.tribeId === t.id);
  const drift = (x: number, d: number) => clamp(x + d + rng.gauss(0, 0.08), 0, 1);
  const nt = civ.createTribeRecord(sim, {
    name: tribeName(rng, t.lang), speciesId: t.speciesId, lang: t.lang,
    culture: { militarism: drift(t.culture.militarism, 0.08), openness: drift(t.culture.openness, -0.05), scholarship: drift(t.culture.scholarship, 0), agrarian: drift(t.culture.agrarian, 0) },
    leader: residents.length ? residents.reduce((a, b) => (b.intelligence > a.intelligence ? b : a)) : null,
    founderX: s.x, founderY: s.y,
  });
  nt.techs = t.techs.slice();
  nt.traditions = t.traditions.slice(0, 2);
  nt.parentTribeId = t.id;
  nt.government = t.techs.includes('governance') ? 'Council of Elders' : 'Chiefdom';
  t.successors.push(nt.id);
  t.settlementIds = t.settlementIds.filter((id) => id !== s.id);
  nt.settlementIds.push(s.id);
  nt.capitalId = s.id;
  const era = currentEra(s);
  era.end = tick;
  era.endReason = `seceded from ${t.name}`;
  s.eras.push({ tribeId: nt.id, tribeName: nt.name, start: tick, end: null, peak: s.population, how: 'seceded', endReason: null });
  s.tribeId = nt.id;
  t.population = Math.max(0, t.population - residents.length);
  nt.population = residents.length;
  nt.peak = Math.max(nt.peak, residents.length);
  for (const c of residents) {
    c.tribeId = nt.id;
    c.job = null;
    c.remember(tick, 'tribe', `Joined the rebellion that founded ${nt.name}`);
  }
  // Migrants heading to the seceding town will re-route on arrival (ownership changed).
  const leader = sim.byId.get(nt.leaderId);
  if (leader) leader.title = 'Rebel Leader';
  t.stability = clamp(t.stability + 0.15, 0, 1);
  t.lowStabilitySince = -1;
  t.lastSecession = tick;
  t.recentLossTick = tick;
  nt.stability = 0.6;
  const civilWar = Math.max(t.culture.militarism, nt.culture.militarism) > 0.45;
  civ.setRelation(t.id, nt.id, civilWar ? -60 : -25, civilWar ? 'war' : 'peace', tick);
  civ.counters.secessions++;
  civ.territoryDirty = true;
  const cause = t.instabilityCause >= 0 ? t.instabilityCause : undefined;
  const ev = settlementEvent(sim, s, {
    cat: 'civ', level: 3, title: civilWar ? 'Civil war' : 'Rebellion',
    text: `${s.name} broke away from ${t.name}${t.instability ? `, worn down by ${t.instability}` : ''}, and became the seat of ${nt.name}.${civilWar ? ' Its former rulers took up arms.' : ''}`,
    tribeId: nt.id, causeId: cause,
  });
  civ.lastLossEvent.set(t.id, ev.id);
  nt.events.push(ev.id);
  t.events.push(ev.id);
  return nt;
}

/** Expansion: send colonists from a crowded or well-stocked settlement to a validated site. */
function tryExpand(sim: Simulation, civ: CivManager, t: Tribe, active: Settlement[]): void {
  if (!active.length || t.population < 16) return;
  const inTransit = civ.groups.filter((g) => g.tribeId === t.id && g.kind === 'colonist').length;
  const maxS = 1 + Math.floor(t.population / 18) + Math.floor(t.techs.length / 4) + (pol(t, 'expansion') > 0 ? 1 : 0) - (pol(t, 'expansion') < 0 ? 1 : 0);
  if (active.length + inTransit >= maxS || inTransit > 0) return;
  if (sim.tick - t.lastExpansion < TICKS_PER_DAY * 6) return;
  let source: Settlement | null = null, ss = -Infinity;
  for (const s of active) {
    if (s.state === 'crisis' || s.state === 'founded' || s.population < 14) continue;
    // Only an established town sends colonists; they carry whatever timber and food it can spare.
    if (structurePoints(s) < 6 || s.econ.nourishment < 0.45) continue;
    const sc = s.population / housingOf(s) + s.econ.prosperity * 0.3;
    if (sc > ss) { ss = sc; source = s; }
  }
  if (!source) return;
  const crowded = source.population > housingOf(source) * 0.8;
  if (!crowded && pol(t, 'expansion') <= 0 && goalW(t, 'expand') < 0.7) return;
  // Colonists set out in the growing seasons, to sites a few days' walk away.
  if (sim.climate.season(sim.tick) === 3) return;
  const site = civ.findSite(sim, t, source.x, source.y, 12, 28, true);
  if (!site) return;
  t.lastExpansion = sim.tick;
  launchColonists(sim, civ, t, source, site, source.lastCause, crowded ? 'room to grow' : `new land for ${t.name}`);
}

export function goalLabels(goals: GoalId[]): string[] {
  return goals.map((g) => GOAL_LABEL[g]);
}

export { TIER_NAMES, TICKS_PER_YEAR };
export type { Creature };
