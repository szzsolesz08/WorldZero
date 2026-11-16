# WORLD ZERO — Project Plan

A living-world simulator: a procedurally generated planet, thousands of autonomous creatures with genomes, evolution and speciation, emergent civilizations, and a god who watches and intervenes. This file tracks milestones, what each delivered, what is known to be incomplete, and where the project goes next. Detailed implementation plans live in `docs/superpowers/plans/`.

## Principles

- **The simulation is the source of truth.** Every number, chart and chronicle entry is measured from simulated state; nothing is scripted or faked for the screen.
- **One representation per thing.** Creatures are the population. Settlements, tribes and migration groups reference creatures; they never hold copies or counters of their own.
- **Deterministic.** All randomness comes from one seeded, serialized PRNG (`Math.random()` is never used in `src/engine`). A seed plus the same god commands reproduces a run, including across save and load.
- **Cheap per tick.** Heavy logic runs on scheduled passes (civilization every 30 ticks, strategy and migration on slower staggered schedules), inside a Web Worker.
- **Extend, don't replace.** New systems plug into the existing engine; no parallel or duplicate systems.

## Milestone 1 — The living world (complete)

Plan: `docs/superpowers/plans/2026-11-16-world-zero.md`.

Delivered:
- **World:** procedural worlds from a seed, with biomes, rivers, lakes, climate, seasons and weather.
- **Creatures:** thousands with 20-gene genomes, a utility AI, memories and families.
- **Evolution:** evolution and speciation, both allopatric and sympatric.
- **Civilizations:** tribes, settlements, technology, trade, diplomacy and war.
- **God mode:** speeds 1/2/10/100× and pause, god tools and disasters.
- **Interface:** a live chronicle, a dark scientific dashboard and a creature inspector.
- **Content and persistence:** eight scenarios, autosave with catch-up, save/load/export, and a Web Worker architecture.

## Milestone 2 — Living civilizations & historical dynamics (complete)

Plan and architecture assessment: `docs/superpowers/plans/milestone-2-living-civilizations.md`.

### New engine modules

| Module | Responsibility |
|---|---|
| `civ/settlements.ts` | per-settlement economy (production/consumption EMAs, reserves, housing from timber and stone, jobs, water, security, disease, nourishment, prosperity, pressure); lifecycle state machine with hysteresis and minimum durations; abandonment; decay by material; ruins; resettlement with eras |
| `civ/migration.ts` | households; normalised destination scoring; internal-first and foreign migration; A*-routed travelling groups; supplies, deaths, re-routing and stranding; reservations and cooldowns; refugees; colonists |
| `civ/strategy.ts` | competing goals; eight player policies with adoption delay, stability cost and history; stability and its causes; rebellion and successor states; capital succession; decline and recovery; expansion by colonists |
| `pathfind.ts` | bounded 8-neighbour A* with waypoint compression |
| `objectives.ts` | optional scenario objectives evaluated from real state |
| `saveUpgrade.ts` | in-place upgrade of version-3 saves to version 4 |
| `invariants.ts` | population-integrity checks used by tests and the soak runner |

### Changes to existing systems

- **Settlements own their stores.** The old tribe-wide store was removed.
- **Real colonists.** Colonization walks real colonists to the site instead of teleporting a third of a town.
- **Refugees from sack and disasters.** Sacked and destroyed towns send survivors out as refugees.
- **Causal events.** Events carry `causeId` links and two new categories, settlement and migration.
- **Housing limits births.** Overcrowded households have fewer children; birth and death stay in `Simulation`.
- **Durable builders.** Builders stay on site until their shift ends. This fixes a latent Milestone 1 bug where they re-rolled jobs every few ticks and housing never grew.
- **Building in treeless land.** Builders in grassland, desert and tundra raise sod, mud-brick and fieldstone housing when timber is scarce. Without this, those towns never built anything and stayed permanently overcrowded (latent Milestone 1 gap).
- **Exact save/load.** Saves now include the per-chunk food cache and the territory-dirty flag, so a world saved at any tick resumes identically (latent Milestone 1 bug).

### Interface

- **Settlement inspector:** opened from towns and ruins.
- **Extended civilization cards:** priorities, stability, food security, capital, settlements, migration, successor states, recent history, and policy controls.
- **Chronicle:** a "Towns" filter and "Because of" cause links that jump to and highlight the causing event.
- **Objectives panel.**
- **Map:**
  - migration routes and markers, sized by group and coloured by kind;
  - four analytical lenses with legends;
  - ruins drawn by remaining timber, stone and walls;
  - overgrown fields;
  - a selection ring.
- **New scenario:** The Great Drought.

### Verification

- `npm test`: 55 tests in 7 files.
  - The existing suites.
  - `settlements.test.ts`: 9 lifecycle tests.
  - `migration.test.ts`: 12 migration tests.
  - `civ-dynamics.test.ts`: 10 civilization, objective, determinism and upgrade tests.
  - Strict invariants are checked after every civilization pass inside these tests.
- `npm run build`: typecheck and production build.
- `scripts/soak.ts`: multi-year headless runs per scenario with invariant checks every 8 passes, lifecycle-state histograms, migration counters and event-title histograms. See the soak table below.

### Soak results (this milestone)

See the end of this file; updated after each balance pass.

### Known gaps and balance notes

- **No roads.** Road decay from the brief therefore does not apply; ruins decay by timber, stone, walls and fields.
- **Vassal states (optional in the brief) are not implemented.** Successor states are fully independent.
- **Short sea crossings only.** Migration routes cross water only for peoples with sailing, and every route is limited to a short distance (`MAX_TRAVEL`). There is no fleet model.
- **Global famines barely move people.** When every town is starving at once (The Great Drought), no destination beats home, so few people migrate. Towns starve, are abandoned and are later resettled. This is emergent and was left untuned, as the brief asks.
- **Evolved predators can wipe out civilizations.** On Civilization seed-b a fast predator species (Swift Fang) multiplies and hunts the sapients to extinction by about year 5. The Milestone 1 baseline on the same seed does the same: its sapients fall from 450 to 2 and only a 20-member successor tribe remains at year 6. This is pre-existing ecology, not a Milestone 2 regression. Primordial seed-a shows a related predator–prey collapse in both versions' lineage.
- **The Great Drought is deliberately harsh.** One seed ends with two small civilizations, the other with none. Its first version stacked two drought mechanisms and was rewritten as a single drought lasting three seasons.
- **About a quarter of migrants strand.** Strandings are mostly winter-adjacent journeys and lone households; stranded people stay members of their people and walk home later.
- **Chronicle throttling.** Notable-individual announcements (apex predator, great journey, great parent) are now limited to one per species and kind per season. "First contact" is still frequent early in multi-species worlds.

## Next milestones (proposed)

1. **Roads and trade networks:**
   - paths worn by repeated travel become roads that speed movement and decay when unused;
   - caravans carry real goods between settlements;
   - trade dependency becomes visible.
2. **Vassalage and diplomacy depth:** tributaries, federations and negotiated borders.
3. **Naval movement:** boats as objects, sea migration and island colonization.
4. **Ecology stability:** prey refuges and predator satiation, so predator–prey collapses are less frequent while still possible.
5. **Performance at scale:** spatial batching for civilization passes, worker-side frame diffing, and larger worlds.

## Soak table

| Scenario · seed | Years | Ended with | Sapient members (peak → end) | Settlements founded / abandoned / resettled | Journeys (arrived / lost / stranded people) | Rebellions | Invariant violations |
|---|---|---|---|---|---|---|---|
| Civilization · seed-a | 6 | 14 civilizations, 22 towns | 692 → 397 | 38 (19 colonies) / 22 / 6 | 100 (72 / 5 lost / 105 people stranded) | 11 | 0 |
| Civilization · seed-b | 6 | no civilizations (all collapsed by year 5.25) | 649 → 0 | 31 (14 colonies) / 32 / 1 | 62 (49 / 3 / 59) | 7 | 0 (re-checked; the first run's 4 were a checker false positive, fixed) |
| The Great Drought · seed-a | 4 | 2 civilizations, 4 towns | 300 → 29 | 18 (7) / 14 / 0 | 18 (14 / 1 / 7) | 0 | 0 |
| The Great Drought · seed-b | 4 | no civilizations | 337 → 0 | 18 (4) / 19 / 1 | 13 (8 / 2 / 9) | 1 | 0 |
| Primordial · seed-a | 6 | ecosystem collapse to 16 creatures (an evolved predator ate out its prey) | 143 → 8 | 10 (2) / 8 / 1 | 7 (4 / 0 / 23) | 2 | 0 |
| Primordial · seed-b | 6 | 3 civilizations, 3 towns | 74 → 53 | 9 (0) / 6 / 0 | 2 (1 / 0 / 4) | 0 | 0 |
| Apocalypse · seed-a | 5 | 3 civilizations, 3 towns | 97 → 10 | 7 (0) / 5 / 1 | 2 (0 / 1 / 15) | 0 | 0 |
| Island Experiment · seed-a | 5 | 11 island civilizations | 260 → 260 | 11 (0) / 0 / 0 | 2 (1 / 0 / 0) | 0 | 0 |

The median tick cost was 2.5–7.6 ms with eight runs sharing the CPU; a single run measures about 2–3 ms.
