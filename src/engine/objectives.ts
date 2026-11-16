/**
 * Optional scenario objectives, evaluated from actual simulation state (never from elapsed time alone).
 * Sandbox scenarios simply have none.
 */
import type { Simulation } from './simulation';
import type { ObjectiveView } from './types';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from './constants';
import { dist2d } from './mathutil';

export type ObjectiveKind =
  | 'civSurvives' | 'settlementPopulation' | 'recoverCapital' | 'resettleRuin' | 'connectedSettlements'
  | 'speciesSurvives' | 'surviveDrought' | 'peaceBetweenRivals';

export interface ObjectiveSpec {
  kind: ObjectiveKind;
  label: string;
  params?: Record<string, number>;
}

export interface ObjectiveState extends ObjectiveView {
  kind: ObjectiveKind;
  params: Record<string, number>;
  data: Record<string, number>;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function initObjectives(sim: Simulation, specs: ObjectiveSpec[] | undefined): ObjectiveState[] {
  return (specs ?? []).map((sp, i) => {
    const o: ObjectiveState = {
      id: i + 1, kind: sp.kind, label: sp.label, params: { ...(sp.params ?? {}) }, data: {}, status: 'active', progress: 0, detail: '', completedTick: null,
    };
    if (sp.kind === 'speciesSurvives') {
      // Protect the species that starts out most endangered.
      const alive = sim.species.list.filter((s) => s.extinctTick === null && s.population > 0).sort((a, b) => a.population - b.population);
      o.data.speciesId = alive[0]?.id ?? -1;
    }
    return o;
  });
}

function finish(sim: Simulation, o: ObjectiveState, status: 'complete' | 'failed', why: string): void {
  o.status = status;
  o.completedTick = sim.tick;
  if (status === 'complete') o.progress = 1;
  sim.events.push({
    tick: sim.tick, cat: 'milestone', level: 3,
    title: status === 'complete' ? 'Objective achieved' : 'Objective failed',
    text: `${o.label}: ${why}`,
  });
}

export function evaluateObjectives(sim: Simulation): void {
  for (const o of sim.objectives) {
    if (o.status !== 'active') continue;
    const tick = sim.tick;
    switch (o.kind) {
      case 'civSurvives': {
        const years = o.params.years ?? 10;
        let best = 0, name = '';
        for (const t of sim.civ.activeTribes()) {
          const age = (tick - t.founded) / TICKS_PER_YEAR;
          if (age > best) { best = age; name = t.name; }
        }
        o.progress = clamp01(best / years);
        o.detail = name ? `${name}: ${best.toFixed(1)} of ${years} years` : 'No civilization exists yet';
        if (best >= years) finish(sim, o, 'complete', `${name} has endured for ${years} years.`);
        break;
      }
      case 'settlementPopulation': {
        const target = o.params.count ?? 100;
        let best = 0, name = '';
        for (const s of sim.civ.activeSettlements()) if (s.population > best) { best = s.population; name = s.name; }
        o.progress = clamp01(best / target);
        o.detail = name ? `${name}: ${best} of ${target}` : 'No settlements yet';
        if (best >= target) finish(sim, o, 'complete', `${name} reached ${best} inhabitants.`);
        break;
      }
      case 'recoverCapital': {
        const t = sim.civ.tribes.filter((x) => x.capitalLostTick > 0 && x.popAtCapitalLoss > 0).sort((a, b) => b.capitalLostTick - a.capitalLostTick)[0];
        if (!t) { o.progress = 0; o.detail = 'No civilization has lost its capital yet'; break; }
        if (t.collapsed) { o.progress = 0; o.detail = `${t.name} collapsed after losing its capital`; break; }
        o.progress = clamp01(t.population / t.popAtCapitalLoss);
        o.detail = `${t.name}: ${t.population} of ${t.popAtCapitalLoss} people`;
        if (t.population >= t.popAtCapitalLoss && t.settlementIds.length > 0 && tick - t.capitalLostTick > TICKS_PER_DAY * 5) {
          finish(sim, o, 'complete', `${t.name} rebuilt its strength after losing its capital.`);
        }
        break;
      }
      case 'resettleRuin': {
        const s = sim.civ.settlements.find((x) => !x.destroyed && x.eras.length > 1 && x.eras[x.eras.length - 1].how === 'resettled');
        const ruins = sim.civ.settlements.filter((x) => x.destroyed).length;
        o.progress = s ? 1 : 0;
        o.detail = s ? `${s.name} lives again` : `${ruins} abandoned site${ruins === 1 ? '' : 's'} await new settlers`;
        if (s) finish(sim, o, 'complete', `${s.name} was resettled.`);
        break;
      }
      case 'connectedSettlements': {
        const target = o.params.count ?? 3;
        const range = o.params.range ?? 35;
        let best = 0, name = '';
        for (const t of sim.civ.activeTribes()) {
          const ss = t.settlementIds.map((id) => sim.civ.settlement(id)).filter((s) => !!s) as { x: number; y: number }[];
          const seen = new Set<number>();
          for (let i = 0; i < ss.length; i++) {
            if (seen.has(i)) continue;
            let size = 0;
            const stack = [i];
            seen.add(i);
            while (stack.length) {
              const a = stack.pop()!;
              size++;
              for (let j = 0; j < ss.length; j++) {
                if (seen.has(j) || dist2d(ss[a].x - ss[j].x, ss[a].y - ss[j].y) > range) continue;
                seen.add(j);
                stack.push(j);
              }
            }
            if (size > best) { best = size; name = t.name; }
          }
        }
        o.progress = clamp01(best / target);
        o.detail = name ? `${name}: ${best} of ${target} connected settlements` : 'No settlements yet';
        if (best >= target) finish(sim, o, 'complete', `${name} holds ${best} settlements within a day's travel of each other.`);
        break;
      }
      case 'speciesSurvives': {
        const years = o.params.years ?? 5;
        const sp = sim.species.get(o.data.speciesId);
        if (!sp) { o.status = 'failed'; break; }
        o.progress = clamp01(tick / (years * TICKS_PER_YEAR));
        o.detail = `${sp.common}: ${sp.population} alive`;
        if (sp.extinctTick !== null) finish(sim, o, 'failed', `${sp.common} went extinct.`);
        else if (tick >= years * TICKS_PER_YEAR) finish(sim, o, 'complete', `${sp.common} survived ${years} years.`);
        break;
      }
      case 'surviveDrought': {
        const frac = o.params.minFraction ?? 0.5;
        const pop = sim.creatures.length;
        const inDrought = sim.climate.droughtTicks > 0;
        if (inDrought && !o.data.start) { o.data.start = pop; o.data.began = tick; }
        if (!o.data.start) { o.progress = 0; o.detail = 'The rains have not yet failed'; break; }
        o.detail = `${pop} of ${o.data.start} creatures (need ${Math.round(frac * 100)}%)`;
        o.progress = inDrought ? clamp01((tick - o.data.began) / Math.max(1, tick - o.data.began + sim.climate.droughtTicks)) : 1;
        if (pop < o.data.start * frac) finish(sim, o, 'failed', `Life fell below ${Math.round(frac * 100)}% of its pre-drought level.`);
        else if (!inDrought) finish(sim, o, 'complete', `The world endured the drought with ${pop} creatures.`);
        break;
      }
      case 'peaceBetweenRivals': {
        const days = o.params.days ?? 30;
        let best = 0, label = '';
        for (const r of sim.civ.relations.values()) {
          const key = r.a * 100000 + r.b;
          if (r.status === 'war') o.data[`w${key}`] = 1;
          if (!o.data[`w${key}`] || r.status === 'war') continue;
          const ta = sim.civ.tribe(r.a), tb = sim.civ.tribe(r.b);
          if (!ta || !tb || ta.collapsed || tb.collapsed) continue;
          const peaceDays = (tick - r.since) / TICKS_PER_DAY;
          if (peaceDays > best) { best = peaceDays; label = `${ta.name} and ${tb.name}`; }
        }
        o.progress = clamp01(best / days);
        o.detail = label ? `${label}: ${Math.floor(best)} of ${days} days of peace` : 'No former enemies are at peace yet';
        if (best >= days) finish(sim, o, 'complete', `${label}, once at war, have kept the peace for ${days} days.`);
        break;
      }
    }
  }
}

export function objectiveViews(sim: Simulation): ObjectiveView[] {
  return sim.objectives.map((o) => ({ id: o.id, kind: o.kind, label: o.label, status: o.status, progress: o.progress, detail: o.detail, completedTick: o.completedTick }));
}
