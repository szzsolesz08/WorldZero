# Milestone 2 — Living Civilizations & Historical Dynamics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn WORLD ZERO's static civilizations into causal history: settlements live, decline, are abandoned, decay into ruins and get resettled; households physically migrate between settlements; refugees flee wars and disasters; civilizations pursue goals, expand, fragment and recover; and the Chronicle records why each of these happened.

**Architecture:** Everything extends the existing pure-TS engine (`src/engine`). `CivManager` stays the hub and delegates to three new focused modules: `civ/settlements.ts` (economy, lifecycle, decay, eras), `civ/migration.ts` (households, groups, travel, refugees, colonists) and `civ/strategy.ts` (goals, policies, stability, rebellion, expansion). Creature membership (`tribeId`, `homeId`, new `migrationId`) stays the only population representation. All new logic runs on the existing 30-tick civ pass, or slower, and never scans every creature each tick.

**Tech Stack:** unchanged (TypeScript, Vite, React, Zustand, Vitest). No new runtime dependencies.

**Spec:** the user's "MILESTONE 2: LIVING CIVILIZATIONS & HISTORICAL DYNAMICS" brief (Parts 1–11).

## 1. Architecture assessment (verified in source, commit c5af9c6)

| # | Concern | Actual implementation | Gap |
|---|---|---|---|
| 1 | Tribes | `CivManager.tribes: Tribe[]`; membership is `creature.tribeId`, recounted each civ pass (`refreshMembership`) | no capital, stability, goals or policies; collapse = zero members |
| 2 | Settlements | `Settlement {tier, health, population, buildings, walls, farms, destroyed}` owned via `tribeId` | **empty settlements stay active forever**; `destroyed` only on sack/disaster/tribe collapse; ruins vanish from frames after 6 days |
| 3 | Population | `creature.homeId` → settlement; homeless members are re-homed to the nearest settlement every pass | re-homing is instant (a teleport of membership) |
| 4 | Births/deaths | `Simulation.tryMate` (child inherits mother's tribe/home), `Simulation.kill` (archive + carcass) | housing has no influence |
| 5 | Movement | `moveToward`: local steering that tries 7 heading offsets; no pathfinding | migrants would stall at coasts and lakes |
| 6 | Resources | **one `tribe.stock` shared by all settlements**; food enters via forage/farm/hunt deposits and leaves via `eatFromStore`; spoilage and caps are tribe-wide | no local shortages, so no basis for migration |
| 7 | Buildings | `settlement.buildings` is one counter (+1 / +1.5 / +1 stone per build); tier thresholds use it | no wood/stone distinction, nothing to decay |
| 8 | Technology | `tribe.techs`, research per pass, culture-weighted choice (`civ/tech.ts`) | fine — reused |
| 9 | Trade/diplomacy | `relations` map (peace/alliance/war), trader job adds food/wood to the partner tribe | imports unrecorded |
| 10 | Warfare | raid job → `sack()` → `ruin()`; residents just lose their home | no refugees |
| 11 | Leadership | `leaderId` succession by score; `government` from techs | no legitimacy or crisis |
| 12 | Territory | `computeTerritory` every 4 passes from non-destroyed settlements | lost settlements vanish from the map instantly |
| 13 | Events | `EventLog` (`SimEvent`, levels 1–3, 1500 cap that prefers dropping minor) | no causes, no migration or settlement categories |
| 14 | Save/load | `Simulation.serialize/deserialize`, `SAVE_VERSION = 3`, seeded `Rng` | old versions are rejected and autosaves deleted |

Also noted: colonisation (`manageSettlements`) teleports a third of the residents to a new site instantly, and the README overstates "farming/trade" as settlement-level economics.

## 2. Data model changes

- **Creature:** `migrationId` (−1, or the id of the group travelling) and `lastMigrated`.
- **Settlement:**
  - lifecycle: `state` (`founded|growing|thriving|stable|declining|crisis|abandoned|ruins`), `stateSince`, `pending`, `pendingSince`.
  - structures: `wood`/`stone` points (replacing `buildings`) and `wallCondition`.
  - economy: `stock` (local stores, now authoritative), `econ` (prod/cons EMA, reserve days, housing, jobs, water, security, disease, crowding, prosperity, pressure, imports).
  - history: `peak`, `popHistory`, `eras[]` (owner, how, start, end, reason), `parentId`, `events[]`.
  - migration: `migIn`/`migOut`, `reserved`, `lastEmigration`, `recentFrom`, `lastCause`.
  - ruins: `oldFarms`/`farmCondition`, `reclaimed`.
- **Tribe:**
  - `capitalId`, `stability`, `lowStabilitySince`.
  - `goals[]`, `policies`, `pendingPolicies`, `policyHistory`.
  - lineage: `parentTribeId`, `successors[]`.
  - history tracking: `lowPoint`/`declining`, `migIn`/`migOut`, `events[]`.
  - `stock` becomes a derived sum of its settlements.
- **CivManager:** `groups: MigrationGroup[]` (id, kind economic|refugee|colonist, origin, dest, members, leader, waypoints, supplies, reason, causeId, progress) and `counters` (abandoned, resettled, founded, migrants, refugees, secessions…).
- **SimEvent:** add `causeId?`, categories `migration` and `settlement`.
- **Scenario:** optional `objectives[]` and `schedule[]` (day → god command).
- **Simulation:** `objectives` state. `SAVE_VERSION 4` with a v3 → v4 upgrader (no silent deletion).

## 3. Systems

1. **Settlement economy (Part 6).**
   - Deposits and store-eating hit the home settlement's `stock`.
   - Each pass derives production and consumption EMAs, reserve days, housing (6 + wood + 1.5·stone), jobs, water (distance and drought), security (threat EMA fed by raids and killed residents), disease and crowding. These feed `prosperity` ∈ [−1, 1] and push `pressure` ∈ [0, 1].
   - Overcrowding halves birth success (creature reproduction stays authoritative).
2. **Lifecycle (Part 2).**
   - The target state comes from prosperity, population trend and age, with state-dependent thresholds (hysteresis) and minimum durations: 1 day to enter crisis, 2 days otherwise, 2 days at zero residents to abandon.
   - Abandonment stops production and recruitment, keeps the name and eras, starts decay (wood τ≈0.6 y × climate, stone half-life ≈ 40 y, walls ≈ 25 y), and turns farms into overgrown fields.
   - It becomes `ruins` once the wood has rotted.
   - Resettling a site within 4 tiles reuses the object: a new era begins, structures are salvaged, and the stone and history survive.
3. **Migration (Part 3).**
   - Planning runs every 4 passes per tribe, staggered.
   - Households are formed from mates and immature children. Each household decides on its own: push × personality, with a 1-year cooldown.
   - Destinations are scored by normalised weights (distance, free housing, food, security, prosperity, jobs, stability, family) and chosen by softmax sampling.
   - Departures are capped at 30% of residents and never cut below 6 residents, unless the settlement has been in crisis for 4 days or more. Capacity is reserved at the destination, and the reverse route is blocked for 60 days.
   - Groups walk A* waypoints (cost = 1/moveMult, ×3 in enemy territory), eat carried supplies, die naturally, and arrive into homes.
   - When stuck, a group re-paths once and then settles or disperses.
4. **Refugees.** Sack, disaster destruction and crisis evacuation send residents to friendly settlements (allowing 1.5× capacity), then to allies (assimilation), and otherwise to found a new settlement or scatter.
5. **Strategy (Part 4).** Goals are re-scored every 10 passes:

   | Goal | Main inputs |
   |---|---|
   | grow, food_security | crowding, food security |
   | expand | crowding, policy |
   | research, trade | culture, techs, allies, policy |
   | defend, conquest | threat, military weakness of neighbours |
   | alliance | openness, threat |
   | recover | recent losses |
   | stability | instability |

   Culture, policy, leader personality and government feed the utilities, and the top 3 win. Goals multiply job weights, research, diplomacy targets and war thresholds.
   - Expansion sends a physical colonist group with supplies and wood (cost) to a validated site, preferring ruins. Settlement count is capped by population and technology. The old teleporting colonisation is removed.
6. **Stability, rebellion, collapse, recovery.**
   - Stability depends on food security, overextension versus governance techs, distance from the capital, war weariness, recent losses, succession and policy.
   - Below 0.3 for 8 days, the most disaffected distant settlement secedes as a successor tribe that keeps the techs, links back to its parent, starts a new era, and may start a civil war.
   - Losing the capital moves the capital, with a stability hit.
   - Decline and recovery events fire on population thresholds.
   - Territory fades from abandoned settlements over a season, scales with population and walls, and large border shifts are reported.
7. **Causal chronicle (Part 5).** Drought, plague, raids and famines record their event id on the affected settlements (`lastCause`). Later famine, migration, abandonment, territory, rebellion and recovery events cite `causeId`. State events are throttled per settlement, and the existing level-based retention keeps major history.
8. **Policies & objectives (Part 7).**
   - Eight policies (low / balanced / high) adopt after a 2-day delay at a stability cost, are recorded in history, and act through goal and job weights.
   - Objectives framework with 8 kinds evaluated from state; the Civilization scenario and a new Great Drought scenario use them; Sandbox has none.

## 4. UI (Part 8, follows DESIGN.md)

- **Settlement inspector:** left column, like the creature inspector, opened by clicking a settlement or ruin. Shows state, population and change, capacity, food, housing, jobs, economy, migration in/out and active groups, structures, recent events, population chart, eras and previous owners.
- **Civ card:** goals, policy controls, stability, food security, military, migration, recent events.
- **Map:**
  - migration route lines and group markers (economic = tribe hue, refugee = danger tint, colonist = amber);
  - settlement condition rings;
  - lenses (condition, prosperity, food, population density);
  - ruins and overgrown fields.
- **Chronicle:** "Settlements & migration" filter and clickable "because of" links.
- **Objectives** panel on the World tab when the scenario has objectives.

## 5. Dependencies / order

economy → lifecycle (needs economy) → migration (needs lifecycle and economy) → refugees and colonists (need migration) → strategy (needs colonists) → stability and rebellion → chronicle causes (touches all) → policies and objectives → worker protocol and UI → persistence upgrade → tests → soak/balance → docs.

## 6. Risks

- **Population integrity.** Mitigation: a single membership model plus `checkInvariants()` run in tests and soak.
- **Migration oscillation.** Mitigation: per-route cooldown, per-creature cooldown, and a required pressure gap of 0.2 or more.
- **Over-abandonment or never-abandon.** Mitigation: hysteresis plus soak metrics.
- **Performance.** A* runs only at group creation (bounded expansions); everything else runs per pass.
- **Balance drift.** The economy refactor changes food dynamics, so re-soak every scenario.
- **Save upgrades.** Mitigation: an explicit v3 upgrader plus a test that round-trips a v3-shaped state.

## 7. Testing strategy

New `tests/settlements.test.ts`, `tests/migration.test.ts` and `tests/civ-dynamics.test.ts`:
- **Lifecycle:** the 8 cases from Part 10.
- **Migration:** the 12 cases from Part 10.
- **Civilization:** the 8 cases from Part 10.
- **Invariants:** `checkInvariants` after every simulated day in a civilization run.
- **Determinism** with commands, including migrations.
- **Save/load mid-journey.**

Soak: `scripts/soak.ts` gains milestone metrics and invariant checks. The long runs are 20 years × {primordial, civilization, survival/drought, apocalypse, islands} × 2 seeds, run in parallel in the background.

## 8. Delivery status

Implemented as planned; deviations and discoveries are listed here.

- **Economy, lifecycle and decay:** done (`civ/settlements.ts`).
  - Food security weighs residents' actual nourishment. Store reserves alone were always near zero, because most food is foraged and eaten directly.
- **Migration:** done (`civ/migration.ts`).
  - Planning tiers, in order: same-civ towns, then open or allied foreign towns, then crisis pioneers.
  - Feasibility rules added after soak findings:
    - fitness to travel;
    - no voluntary departures in winter;
    - a 55-tile radius for voluntary moves;
    - a wider arrival radius;
    - immediate re-routing when a destination is lost.
- **Strategy, policies, rebellion, capitals and expansion:** done (`civ/strategy.ts`).
  - Goal hysteresis was added after soak runs showed priority churn.
- **Chronicle causes:** done. Disasters, drought, plague, abandonment, refugees, capital loss, rebellion and collapse link to their causes.
- **Objectives:** done (`objectives.ts`). There are 8 objective kinds, attached to Civilization, Drought and Apocalypse.
- **Persistence:** `SAVE_VERSION` 4 with a v3 upgrader.
  - Two latent Milestone 1 determinism gaps were fixed: the chunk-food cache and the territory-dirty flag are now saved.
- **Fixed latent Milestone 1 bug:** builders re-rolled their job every decision and never finished building, so housing and tiers never grew.
- **No immediate return:** a people cannot resettle a town it abandoned within the same season.
- **Building in treeless land:** builders fall back to sod, mud brick and fieldstone; before this, grassland and desert towns never gained housing.
- **Chronicle throttle:** notable-individual announcements are limited to one per species and kind per season.
- **Invariant counting:** the strict check counts creatures killed after the civilization pass in the same tick, which removes a false positive at day boundaries.
- **UI:** done as specified in section 4.
- **Tests:** 31 new tests. Strict invariants run after every civilization pass inside them.
- **Not done:**
  - **Road decay:** there are no roads in the engine.
  - **Vassal states:** optional in the brief.
- **Soak runs:** 4 to 8 in-game years per scenario rather than the planned 20, so that every scenario and seed could run in parallel within the session. Results are summarised in `PROJECT_PLAN.md`.
