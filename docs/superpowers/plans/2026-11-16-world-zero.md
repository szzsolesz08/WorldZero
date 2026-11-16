# WORLD ZERO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-based living-world simulator in which thousands of autonomous, genetically-defined creatures eat, drink, flee, breed, evolve into new species, form tribes, found settlements, research technology and wage war on a procedurally generated planet, while a god-mode user watches and intervenes.

**Architecture:** A pure-TypeScript deterministic simulation engine (`src/engine`, no DOM) runs inside a Web Worker and streams compact typed-array frames to the main thread. A Canvas2D renderer (`src/render`) draws terrain, overlays, creatures, settlements and weather with camera/zoom/pan, independently of React. A React dashboard (`src/ui`) subscribes to a low-frequency store (≤4 Hz) for statistics, events, inspector and controls. Commands from the UI are queued into the worker and applied at tick boundaries, so a seed + command list reproduces a run.

**Tech Stack:** Vite, React 19, TypeScript (strict), Zustand (UI store), lucide-react (icons), @fontsource (Inter, JetBrains Mono, Chakra Petch), Vitest (engine tests), tsx (headless soak script). No rendering library — Canvas2D with sprite caches.

**Spec:** The user's WORLD ZERO brief in the first message of the session (sections 1–11).

## Global Constraints

- Simulation logic lives only in `src/engine/**` and must not import DOM, React or render code.
- No `Math.random()` in the engine; all randomness flows through the seeded `Rng` whose state is serialized.
- Speeds: 1x, 2x, 10x, 100x, plus pause. 1x = 30 ticks/s. Worker runs ticks within a 12 ms budget per slice and reports the actual tick rate.
- Time: 240 ticks/day, 5 days/season, 4 seasons/year (4800 ticks/year).
- Default world 256 × 160 tiles. Hard population cap 4000 (births suppressed above it).
- Seven preset scenarios: Garden of Eden, Survival, Ice Age, Predator Paradise, Island Experiment, Civilization, Apocalypse — plus custom scenarios saved to localStorage.
- Save/load full state (IndexedDB autosave + JSON file export/import). The world resumes on reopen and fast-forwards for the time away (capped).
- Dark, futuristic, glass-panel UI; responsive down to 1280 px wide without overlap; main thread never blocked by simulation.

## Review Focus

1. Population explosion or total die-off in the preset scenarios: the soak test asserts each preset keeps 30 ≤ population ≤ 4000 for its first 2 in-game years.
2. Everything going extinct: vegetation, weather and the UI keep running, charts render with zero data, and "Introduce species" brings life back (test: `simulation.test.ts › survives total extinction`).
3. The selected creature dying while the user is watching it: the inspector switches to its archived death record, and follow mode stops (test: `simulation.test.ts › inspect returns archived record for dead creature`).
4. A corrupt or incompatible autosave: the app starts a fresh world instead of crashing (version field checked; `persistence.ts` catches and discards).
5. A god tool clicked on ocean (spawn): creatures are placed on the nearest land tile, never in deep water (test: `commands.test.ts › spawn on ocean snaps to land`).

---

## File Structure

```
src/engine/            pure simulation (worker + node tests)
  rng.ts               Rng (sfc32): next(), range(), int(), gauss(), pick(), getState()/setState()
  noise.ts             createNoise2D(rng) simplex; fbm(); ridged()
  constants.ts         time constants, tuning knobs (one place to balance)
  types.ts             shared plain-data types (views, payloads, commands, events)
  world/biomes.ts      Biome enum + table {name,color,fertility,moveCost,shelter}
  world/world.ts       World: typed arrays + accessors (idx, isLand, isWater, biomeAt…)
  world/worldgen.ts    generateWorld(params: WorldGenParams, rng: Rng): World
  world/climate.ts     Climate: season, daylight, global temp/rain, weather cells, tileTemp()
  world/vegetation.ts  updateVegetation(world, climate, mult): regrowth/decay, fires
  spatial.ts           SpatialHash: rebuild(creatures), queryRadius(x,y,r,out)
  creatures/genome.ts  GENES, randomGenome(template,rng), crossover, mutate, geneticDistance
  creatures/creature.ts Creature class + derivePhenotype(genome)
  creatures/behavior.ts decide(c, sim) utility AI; act(c, sim) movement + interactions
  creatures/names.ts   creatureName(), speciesName(), tribeName(), settlementName()
  evolution/species.ts SpeciesRegistry: assign, speciation (2-means split), extinction, tree
  civ/tech.ts          TECHS table + chooseNextTech(tribe)
  civ/civilization.ts  CivManager: tribe formation, settlements, jobs, territory, diplomacy, war
  disasters.ts         applyCommand(sim, cmd), natural disaster scheduler
  events.ts            EventLog: push(event), since(id)
  stats.ts             StatsTracker: per-day samples, history series, diversity, eco health
  scenarios.ts         SCENARIOS presets + species templates
  simulation.ts        Simulation: create(), tick(), queueCommand(), serialize()/deserialize(), views
src/worker/protocol.ts  message unions Main↔Worker
src/worker/sim.worker.ts loop, speed control, frame packing, save/load, catch-up
src/client/simClient.ts typed wrapper over the worker
src/client/store.ts     Zustand store (stats, events, selection, tools, settings)
src/client/persistence.ts IndexedDB autosave, file export/import, custom scenarios
src/render/camera.ts    Camera (pan/zoom/follow, screen↔world)
src/render/terrainPainter.ts paintTerrain(terrain): ImageData at 6 px/tile with hillshade
src/render/sprites.ts   creature sprite cache keyed by quantized appearance
src/render/weatherFx.ts clouds, rain, snow, lightning, god-tool effects
src/render/renderer.ts  WorldRenderer: rAF loop, layers, smoothing, picking, minimap
src/ui/**               App, TopBar, GodToolbar, EnvironmentPanel, Dashboard tabs, Inspector,
                        EventFeed, ScenarioDialog, charts/* (Line, StackedArea, Radar, Spark, PhyloTree)
tests/*.test.ts         vitest engine tests
scripts/soak.ts         headless balance runner: per-scenario population trajectories
```

## Key Model Decisions

**Genome** (20 genes, each 0..1): size, speed, perception, strength, intelligence, sociability, aggression, curiosity, fertility, longevity, coldTol, heatTol, diet (0 herbivore → 1 carnivore), swim, immunity, nocturnal, hue, saturation, pattern, shape. Appearance genes drift neutrally, so species colours diverge visibly over time. Mutation: per-gene probability `mutationRate` (default 0.08), Gaussian σ 0.06; rare macro-mutation (p 0.004, σ 0.25). Distance is a weighted RMS (hue circular, appearance weight 0.3). Mating requires distance < 0.22.

**Trade-offs that make selection real:** basal energy cost ∝ size^0.75 × (1 + 0.35·intelligence + 0.25·perception + 0.2·coldTol·heatTol); movement cost ∝ speed² × size; cold tolerance costs extra in heat and vice versa; carnivores cannot digest plants; intelligence pays off only through tribes.

**Needs:** energy (hunger), hydration (fresh water: rivers/lakes; rain lets creatures drink anywhere), health, temperature comfort, safety, mating urge, social need, sleep (diurnal/nocturnal). Utility AI re-decides every 6 ticks (staggered) or immediately when attacked.

**Ecology:** vegetation grid regrows logistically toward a cap set by biome fertility × season × temperature × rainfall × food multiplier; carcasses feed carnivores and scavengers; wildfires spread through vegetation.

**Speciation:** every 600 ticks, each species with ≥ 16 members gets a 2-means split; if the centroid distance is > 0.13 and the smaller cluster is ≥ 8, the smaller cluster becomes a child species. Species records are kept forever, which gives the phylogenetic tree. Dead creatures go to a bounded archive (30k) so family trees can show the dead.

**Civilization ladder:** band (≥4 intelligent social kin, int ≥ 0.45) → camp → village → town → city. A tribe has a stockpile (food, wood, stone, ore), research, a culture (militarism, openness, scholarship, agrarian), a government, traditions and relations. Jobs: forage, woodcut, mine, farm, build, guard, raid, trade. Tech tree: language, tools, fire, hunting, agriculture, pottery, construction, sailing, bronze, writing, trade, masonry, governance, medicine, engineering, philosophy. The next tech is chosen from culture weights. Diplomacy runs on a −100..100 relation per pair → alliance / war / peace; wars send raiders against settlements; a tribe that loses its settlements and members collapses.

## Milestones (each ends with: run tests, run app, check in browser, fix, commit)

### Task 1: Scaffold
- [ ] package.json, tsconfig, vite.config, index.html, fonts, base CSS tokens; `npm run dev` serves a page; `npm test` runs vitest.

### Task 2: Engine core + world generation
- [ ] `tests/world.test.ts`: same seed → identical heights; land fraction 0.3–0.7 (0.15–0.5 archipelago); ≥ 1 river tile; ≥ 5 distinct biomes; water-distance field 0 on fresh water.
- [ ] Implement rng, noise, biomes, world, worldgen (continent mask + fbm + ridged mountains, latitude/elevation temperature, moisture, downhill rivers and lake filling, landmass labelling, fresh-water BFS field), climate, vegetation.

### Task 3: Creatures + behaviour + ecology
- [ ] `tests/simulation.test.ts`: determinism (two runs → same hash after 2000 ticks); serialize → deserialize → continue gives the same hash; births and deaths > 0 in 3000 ticks; survives total extinction; inspect returns archived record for a dead creature.
- [ ] Implement genome, creature, spatial hash, behaviour, simulation tick, and `scripts/soak.ts`.

### Task 4: Evolution
- [ ] `tests/species.test.ts`: two synthetic, well-separated clusters inside one species split into parent + child; an empty species is marked extinct with its tick.
- [ ] Implement SpeciesRegistry, archive, family lookup, stats (diversity, mutation frequency, trait means).

### Task 5: Civilizations
- [ ] `tests/civ.test.ts`: the Civilization scenario forms ≥ 1 tribe and ≥ 1 settlement within 2 in-game years; tech prerequisites are respected.
- [ ] Implement CivManager and tech.

### Task 6: Events, god commands, disasters, scenarios
- [ ] `tests/commands.test.ts`: spawn on ocean snaps to land; smite removes creatures in the radius; earthquake changes heights in the radius only; drought lowers the rain multiplier for its duration.
- [ ] Implement disasters, scenarios, event detectors (speciation, extinction, apex predator, decline/boom, journeys, new landmass, tribes/settlements/tech/alliances/wars/collapse, milestones).

### Task 7: Worker + renderer
- [ ] Worker loop with tick budget, frame packing (Float32Array, 12 floats per creature), periodic layers/stats; renderer with terrain painting, overlays (vegetation, snow, territory), creature sprites with smoothing, settlements, clouds/rain/snow/lightning, day/night lighting, camera, picking, minimap. Verify in the browser: world visible, creatures moving, zoom/pan, click-select.

### Task 8: Dashboard UI
- [ ] Top bar (time, speeds, seed, scenarios, save/load), god toolbar + environment panel, dashboard tabs (Overview, Evolution, Civilizations, Environment, Chronicle), inspector with genes radar, needs, goals, family, relationships, life history, follow; live event feed with click-to-locate; tribe/settlement inspector. Verify every control in the browser.

### Task 9: Persistence
- [ ] IndexedDB autosave every 60 s, resume + fast-forward on reopen (cap 24 in-game days) with a "while you were away" summary; export/import JSON; custom scenarios. Verify by reloading the page.

### Task 10: Balance + polish + launch
- [ ] Soak every preset; tune `constants.ts` until the Review Focus #1 bounds hold and each preset shows its intended dynamic (Eden boom, Ice Age cold adaptation, Island speciation, Civilization settlements, Apocalypse collapse). README usage guide; launch the dev server.
