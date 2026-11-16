/**
 * Population-integrity invariants. Used by tests and the soak runner; never by the simulation itself.
 * Every creature exists once, belongs to at most one settlement or one travelling group, and the
 * civilization layer never holds people that the creature list does not.
 */
import type { Simulation } from './simulation';

/**
 * Returns a list of violations (empty when consistent).
 * `strict` also checks cached counts, which are only exact right after a civilization pass.
 */
export function checkInvariants(sim: Simulation, strict = false): string[] {
  const errs: string[] = [];
  const civ = sim.civ;
  const ids = new Set<number>();
  const residents = new Map<number, number>();
  const tribePop = new Map<number, number>();
  for (const c of sim.creatures) {
    if (ids.has(c.id)) errs.push(`duplicate creature id ${c.id}`);
    ids.add(c.id);
    // The dead stay listed until the next tick's compaction. Cached counts were taken while they lived,
    // so they still count toward their settlement and tribe, but are otherwise skipped.
    if (!c.alive) {
      if (c.homeId >= 0) residents.set(c.homeId, (residents.get(c.homeId) ?? 0) + 1);
      if (c.tribeId >= 0) tribePop.set(c.tribeId, (tribePop.get(c.tribeId) ?? 0) + 1);
      continue;
    }
    if (sim.byId.get(c.id) !== c) errs.push(`creature ${c.id} missing from index`);
    if (c.tribeId >= 0) {
      const t = civ.tribe(c.tribeId);
      if (!t) errs.push(`creature ${c.id} in unknown tribe ${c.tribeId}`);
      else if (strict && t.collapsed) errs.push(`creature ${c.id} in collapsed tribe ${t.name}`);
      tribePop.set(c.tribeId, (tribePop.get(c.tribeId) ?? 0) + 1);
    } else if (c.homeId >= 0 || c.migrationId >= 0) {
      errs.push(`tribeless creature ${c.id} has home ${c.homeId} / group ${c.migrationId}`);
    }
    if (c.migrationId >= 0) {
      const g = civ.group(c.migrationId);
      if (!g) errs.push(`creature ${c.id} in unknown group ${c.migrationId}`);
      else {
        if (!g.members.includes(c.id)) errs.push(`creature ${c.id} not listed in its group ${g.id}`);
        if (g.tribeId !== c.tribeId) errs.push(`creature ${c.id} (tribe ${c.tribeId}) travels with group ${g.id} of tribe ${g.tribeId}`);
      }
      if (c.homeId >= 0) errs.push(`migrant ${c.id} still has home ${c.homeId}`);
    }
    if (c.homeId >= 0) {
      const s = civ.settlement(c.homeId);
      if (!s) errs.push(`creature ${c.id} lives in unknown settlement ${c.homeId}`);
      else {
        if (s.destroyed) errs.push(`creature ${c.id} lives in abandoned ${s.name}`);
        if (strict && s.tribeId !== c.tribeId) errs.push(`creature ${c.id} (tribe ${c.tribeId}) lives in ${s.name} of tribe ${s.tribeId}`);
      }
      residents.set(c.homeId, (residents.get(c.homeId) ?? 0) + 1);
    }
  }
  const inGroups = new Set<number>();
  for (const g of civ.groups) {
    if (civ.group(g.id) !== g) errs.push(`group ${g.id} missing from index`);
    for (const id of g.members) {
      if (inGroups.has(id)) errs.push(`creature ${id} listed in two groups`);
      inGroups.add(id);
      const c = sim.byId.get(id);
      // Dead members are pruned on the group's next update; a living one must point back.
      if (c && c.alive && c.migrationId !== g.id) errs.push(`group ${g.id} lists creature ${id} travelling with ${c.migrationId}`);
    }
    if (strict && g.members.length === 0) errs.push(`empty group ${g.id} still active`);
  }
  if (civ.groups.length !== civ.groupById.size) errs.push(`group index size ${civ.groupById.size} ≠ ${civ.groups.length}`);
  for (const s of civ.settlements) {
    if (s.destroyed && sim.creatures.some((c) => c.alive && c.homeId === s.id)) errs.push(`abandoned ${s.name} still has residents`);
    if (s.destroyed && s.population !== 0) errs.push(`abandoned ${s.name} reports population ${s.population}`);
    if (strict && !s.destroyed && s.population !== (residents.get(s.id) ?? 0)) errs.push(`${s.name} reports ${s.population} people, has ${residents.get(s.id) ?? 0}`);
    if (!s.destroyed) {
      const t = civ.tribe(s.tribeId);
      if (!t || t.collapsed) errs.push(`active ${s.name} belongs to missing/collapsed tribe ${s.tribeId}`);
      else if (!t.settlementIds.includes(s.id)) errs.push(`active ${s.name} not listed by ${t.name}`);
    }
  }
  for (const t of civ.tribes) {
    if (t.collapsed) continue;
    for (const sid of t.settlementIds) {
      const s = civ.settlement(sid);
      if (!s || s.destroyed || s.tribeId !== t.id) errs.push(`${t.name} lists settlement ${sid} it does not hold`);
    }
    if (strict && t.population !== (tribePop.get(t.id) ?? 0)) errs.push(`${t.name} reports ${t.population} members, has ${tribePop.get(t.id) ?? 0}`);
  }
  return errs;
}
