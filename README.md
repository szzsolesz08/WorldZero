# WORLD ZERO

An interactive living-world simulator. A procedurally generated planet is populated with thousands of autonomous creatures that eat, drink, flee, hunt, court, raise young, form herds and tribes, evolve into new species, found settlements, research technology, trade, wage war, migrate, abandon and resettle towns, rebel and recover — and keep doing it whether you watch or not.

Nothing on screen is scripted: every creature runs its own needs-driven decision loop, carries a 20-gene genome, remembers its life and its relationships, and passes its genes on. Statistics, species trees and the chronicle are measured from that simulation, never faked.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first visit forges a *Primordial World*; afterwards the world is autosaved every 45 seconds (and when you leave the tab), and when you come back it **catches up on the time you were away** (up to 24 in-game days) and tells you what happened.

Other commands:

```bash
npm test            # engine test suite (determinism, save/load, speciation, settlements, migration, civilizations)
npm run soak -- all 2   # headless balance run: every scenario for 2 in-game years, with population-integrity checks
npx tsx scripts/civdiag.ts civilization 1 seed-a 4   # per-settlement economy snapshots for one run
npm run build       # typecheck + production build
```

## How to play god

| Action | How |
|---|---|
| Pause / resume | `Space` or the transport in the top bar |
| Speed 1× · 2× · 10× · 100× | keys `1`–`4` or the transport. The actual simulated rate is shown beside it (100× runs as fast as your machine allows) |
| Pan / zoom | drag the map, mouse wheel, `WASD` / arrow keys, `+` / `-`, `0` to fit the world |
| Inspect a creature | click it (Inspect tool). Press `F` or **Follow** to keep it centred and trace its path |
| Inspect a settlement | click a town or a ruin: the **settlement inspector** shows its state and why, condition meters (prosperity, food security, reserves, water, safety, room, work, health), its economy, journeys to and from it, buildings, population history, every era it has lived through and its recorded events. Click a travelling group to open the town it left |
| Inspect a civilization | **Civs** tab: stability, food security, priorities, capital, settlements (click to inspect), migration, successor states, recent history |
| Set policies | in a civilization's card: Expansion, Agriculture, Trade, Research, Diplomacy, Military, Conservation and Internal stability, each Low · Balanced · High. A change takes 2 days to adopt and costs a little stability |
| Read the map | minimap **Layers**: territory, vegetation, weather, names, migration routes. **Lens**: settlement condition, prosperity, food security, population |
| God tools | left rail: create life, smite, bless or blight the land, rain / storm / snow clouds, earthquake, meteor, volcano, wildfire, plague, raise or lower land. Pick a tool, then click the map. `Esc` returns to Inspect |
| World powers | the wand at the bottom of the rail: drought, global storms, ice age, global warming, clear skies, add creatures, cull, introduce new species |
| Change the climate | **Climate** tab: global temperature, rainfall, food abundance, mutation rate, natural-disaster frequency |
| New world / scenario | **New world** (`N`): nine presets plus your saved custom scenarios; type or roll a seed. *Restart this world* replays the same seed |
| Save / load | the save and folder icons store a world in the browser; the arrow icons export / import a `.json` file |
| Toggle dashboard | `Tab` or the panel icon at the top right |

Every entry in the live event ticker and the **Chronicle** is clickable: the camera flies to where it happened and opens the creature or settlement involved. Events that were caused by an earlier one show a **Because of** line: follow it to walk a chain of history backwards (a meteor → a town lost → refugees → a new capital).

## What's simulated

**World.** Continents or archipelagos from simplex noise with ridged mountains; latitude- and altitude-driven temperature; moisture with rain shadows of coast and latitude; priority-flood lakes and flow-accumulation rivers; 17 biomes; landmass naming. Vegetation regrows logistically toward a climate-dependent capacity, dies back in winter and drought, burns in wildfires, and is boosted by farms. Weather cells (rain, storms, snow) drift with the wind; seasons, day and night, droughts, climate trends and impact winters change biomes as glaciers advance or retreat.

**Creatures.** A genome of 20 genes (size, speed, perception, strength, intelligence, sociability, aggression, curiosity, fertility, longevity, cold and heat tolerance, diet, swimming, immunity, nocturnality and four appearance genes) becomes a phenotype with real trade-offs: big brains, keen senses and insulation all cost energy every tick. Creatures manage hunger, thirst, health, temperature, sleep and safety with a utility AI: graze, hunt (stalk and pounce with limited stamina), scavenge, smell their way to water, flee and raise alarm calls, shelter from storms and cold, court mates (pair bonds, kin avoidance, genetic compatibility), feed and defend their young, socialize and explore. Each keeps memories, relationships and a family tree.

**Evolution.** Offspring inherit by crossover and mutation (rare macro-mutations included). Selection is never coded in — it falls out of who survives and breeds. Every 600 ticks each species is checked for divergence: populations isolated on different landmasses (allopatric) or splitting into two genetic clusters (sympatric) become new species with trait-based Latin names. Extinctions, booms and crashes are detected and reported. The Evolution tab shows species populations over time, the tree of life and trait means drifting across generations.

**Civilizations.** When four or more intelligent, social creatures of one species meet, they form a tribe with its own culture (militarism, openness, scholarship, agrarianism), traditions and government. Tribes settle by water, gather food, wood, stone and ore, store food for winter, farm, build, and grow from camp to village, town and city. Research follows a 16-technology tree chosen by culture and environment (sailing for coastal peoples, fire for cold ones). Neighbours meet, trade, ally, go to war, raid and sack settlements, and civilizations can collapse.

**Settlements and their history.** Every settlement keeps its own stores and economy: food gathered and eaten (smoothed per day), reserves, housing built from timber and stone, jobs, water, safety from raids, disease and how well fed its people actually are. These combine into a prosperity score and a *pressure to leave*. A lifecycle state follows from them — founded, growing, thriving, stable, declining, crisis — with separate thresholds to enter and leave a state and a minimum time in each, so towns do not flicker. A town whose last people leave or die is **abandoned**: it stops producing, building and recruiting and stops being a capital, but keeps its name, founder, peak, dates, events and every previous owner. Abandoned places decay by material — timber rots within a few years (faster in warm, wet climates), stone and walls last decades, fields go wild within months — until only ruins and finally reclaimed land remain. Ruins can be **resettled**: the newcomers reuse the stonework and surviving fields and the settlement records a new era. A people never moves straight back into a town it abandoned within the season.

**Migration.** People move as households (an adult, their mate and their young children) — the same creatures, walking, never copies or counters. Each household weighs pressure at home (hunger, crowding, insecurity, disease, idleness) against destinations scored on distance, room, food, safety, prosperity, work and stability (normalised, configurable weights, with a softmax so families choose differently). Migration stays within their own people first; open or allied neighbours take in emigrants when no town of their own will do. Groups follow A* routes around water and mountains (avoiding enemy land), carry supplies, eat on the road, can die on the way, re-route once if stuck and otherwise strand rather than wander forever. Safety rules keep it sane: no town is drained below a viable size by choice, destinations are booked so they cannot overfill, recently used routes cannot flow back (no oscillation), each creature waits a year between voluntary moves, households only leave when fit for the road, and nobody sets out into winter unless their town is failing. Towns destroyed by war or disaster send their survivors out as **refugees** (shown in red) to kin or allies, and colonists (amber) found new settlements — or resettle ruins — only where they physically arrive.

**Civilizations as actors.** Each civilization pursues three competing priorities (grow, secure food, expand, research, trade, defend, conquer, seek alliances, recover, restore order) chosen from its culture, government, situation and policies. Expansion is gradual and costly: colonists leave an established town in the growing season, with a limit on settlements per people. Stability falls with hunger, overextension, distance, war, recent losses, succession and a lost capital; long unrest makes a distant town **rebel** and found a successor state (a civil war if either side is militant). Losing a capital moves the seat of power; civilizations that fall to half their peak are declared in decline and later recover — or collapse, leaving their towns as ruins.

**A causal chronicle.** New event categories for settlements and migration sit beside the existing ones; each event is raised by an actual state change, many carry a link to the event that caused them, and repetitive events are throttled or aggregated.

## Scenarios

| Scenario | What to watch |
|---|---|
| Primordial World | a balanced start: food webs settle into predator–prey cycles |
| Garden of Eden | abundance — populations boom toward the cap |
| Survival | scarcity — efficient, heat-tolerant lineages win |
| Ice Age | temperatures fall every year; watch cold tolerance rise and glaciers spread |
| Predator Paradise | packs and night stalkers — prey speed and vigilance under pressure |
| Island Experiment | one ancestor on every island; isolation produces new species |
| Civilization | several sapient species — tribes, towns, technology, trade and war |
| The Great Drought | young civilizations settle a fertile world; at the end of the first summer the rains fail for three seasons — watch famine, migration, abandonment and recovery |
| Apocalypse | rising heat and ever more frequent disasters |

Some scenarios carry optional **objectives** (World tab), evaluated from real simulation state: keep a civilization alive for 25 years, grow a town to 120, hold three connected settlements, resettle a ruin, recover from losing a capital, bring former enemies to a lasting peace, keep the rarest species alive, keep half of all life through a drought. Sandbox worlds have none.

Save your current climate settings as a custom scenario from the New world dialog.

## Architecture

```
src/engine/     deterministic simulation (pure TypeScript, no DOM) — runs in the worker, tests and soak script
  world/        world generation, climate & weather, vegetation, biomes
  creatures/    genome, phenotype, behaviour (utility AI), names
  evolution/    species registry and speciation
  civ/          civilization.ts (tribes, jobs, diplomacy, territory, war), settlements.ts (economy, lifecycle, decay,
                eras, resettlement), migration.ts (households, groups, travel, refugees, colonists), strategy.ts
                (goals, policies, stability, rebellion, capitals, expansion), tech.ts
  pathfind.ts   A* over the tile grid for travelling groups
  objectives.ts optional scenario objectives       invariants.ts  population-integrity checks (tests, soak)
  saveUpgrade.ts upgrades older saves in place      simulation.ts  tick loop, births/deaths, archive, events, serialization
src/worker/     the simulation Web Worker and its message protocol
src/render/     Canvas2D renderer: painted terrain, soft overlays, sprites, weather, lighting, effects
src/ui/         React dashboard, inspector, god tools, charts, dialogs
src/client/     worker client, UI store, IndexedDB persistence
tests/          vitest suites;  scripts/  soak, profiling and world-preview tools
```

- All randomness flows through a seeded, serializable PRNG, so a seed plus the same god commands reproduces a run exactly (tested).
- The simulation runs in a Web Worker within a per-slice time budget and streams compact `Float32Array` frames; the renderer interpolates motion between frames, so the interface stays responsive at any speed.
- Population lives in exactly one place — the creature list. A creature belongs to at most one settlement (`homeId`) or one travelling group (`migrationId`); settlement and tribe counts are derived from it, and `checkInvariants` verifies this after every civilization pass in the tests and soak runs.
- New systems run on the existing 30-tick civilization pass or slower (migration planning every 4 passes, strategy every 10, staggered per tribe), so the per-tick cost is unchanged.
- Saves are full simulation snapshots (IndexedDB, or exported JSON with typed arrays base64-encoded). Saves are versioned: version-3 worlds from before Milestone 2 are upgraded on load (tribe stores are shared out to their settlements, housing is inferred, migration and strategy state initialised); a save from an unsupported version is kept untouched and simply not resumed.
