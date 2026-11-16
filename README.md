# WORLD ZERO

An interactive living-world simulator. A procedurally generated planet is populated with thousands of autonomous creatures that eat, drink, flee, hunt, court, raise young, form herds and tribes, evolve into new species, found settlements, research technology, trade, wage war — and keep doing it whether you watch or not.

Nothing on screen is scripted: every creature runs its own needs-driven decision loop, carries a 20-gene genome, remembers its life and its relationships, and passes its genes on. Statistics, species trees and the chronicle are measured from that simulation, never faked.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first visit forges a *Primordial World*; afterwards the world is autosaved every 45 seconds (and when you leave the tab), and when you come back it **catches up on the time you were away** (up to 24 in-game days) and tells you what happened.

Other commands:

```bash
npm test            # engine test suite (determinism, save/load, speciation, civilizations, god commands)
npm run soak -- all 2   # headless balance run: every scenario for 2 in-game years
npm run build       # typecheck + production build
```

## How to play god

| Action | How |
|---|---|
| Pause / resume | `Space` or the transport in the top bar |
| Speed 1× · 2× · 10× · 100× | keys `1`–`4` or the transport. The actual simulated rate is shown beside it (100× runs as fast as your machine allows) |
| Pan / zoom | drag the map, mouse wheel, `WASD` / arrow keys, `+` / `-`, `0` to fit the world |
| Inspect a creature | click it (Inspect tool). Press `F` or **Follow** to keep it centred and trace its path |
| Inspect a civilization | click a settlement — the Civs tab opens on that tribe |
| God tools | left rail: create life, smite, bless or blight the land, rain / storm / snow clouds, earthquake, meteor, volcano, wildfire, plague, raise or lower land. Pick a tool, then click the map. `Esc` returns to Inspect |
| World powers | the wand at the bottom of the rail: drought, global storms, ice age, global warming, clear skies, add creatures, cull, introduce new species |
| Change the climate | **Climate** tab: global temperature, rainfall, food abundance, mutation rate, natural-disaster frequency |
| New world / scenario | **New world** (`N`): seven presets plus your saved custom scenarios; type or roll a seed. *Restart this world* replays the same seed |
| Save / load | the save and folder icons store a world in the browser; the arrow icons export / import a `.json` file |
| Toggle dashboard | `Tab` or the panel icon at the top right |

Every entry in the live event ticker and the **Chronicle** is clickable: the camera flies to where it happened (and selects the creature involved).

## What's simulated

**World.** Continents or archipelagos from simplex noise with ridged mountains; latitude- and altitude-driven temperature; moisture with rain shadows of coast and latitude; priority-flood lakes and flow-accumulation rivers; 17 biomes; landmass naming. Vegetation regrows logistically toward a climate-dependent capacity, dies back in winter and drought, burns in wildfires, and is boosted by farms. Weather cells (rain, storms, snow) drift with the wind; seasons, day and night, droughts, climate trends and impact winters change biomes as glaciers advance or retreat.

**Creatures.** A genome of 20 genes (size, speed, perception, strength, intelligence, sociability, aggression, curiosity, fertility, longevity, cold and heat tolerance, diet, swimming, immunity, nocturnality and four appearance genes) becomes a phenotype with real trade-offs: big brains, keen senses and insulation all cost energy every tick. Creatures manage hunger, thirst, health, temperature, sleep and safety with a utility AI: graze, hunt (stalk and pounce with limited stamina), scavenge, smell their way to water, flee and raise alarm calls, shelter from storms and cold, court mates (pair bonds, kin avoidance, genetic compatibility), feed and defend their young, socialize and explore. Each keeps memories, relationships and a family tree.

**Evolution.** Offspring inherit by crossover and mutation (rare macro-mutations included). Selection is never coded in — it falls out of who survives and breeds. Every 600 ticks each species is checked for divergence: populations isolated on different landmasses (allopatric) or splitting into two genetic clusters (sympatric) become new species with trait-based Latin names. Extinctions, booms and crashes are detected and reported. The Evolution tab shows species populations over time, the tree of life and trait means drifting across generations.

**Civilizations.** When four or more intelligent, social creatures of one species meet, they form a tribe with its own culture (militarism, openness, scholarship, agrarianism), traditions and government. Tribes settle by water, gather food, wood, stone and ore, store food for winter, farm, build, and grow from camp to village, town and city. Research follows a 16-technology tree chosen by culture and environment (sailing for coastal peoples, fire for cold ones). Neighbours meet, trade, ally, go to war, raid and sack settlements, and civilizations can collapse.

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
| Apocalypse | rising heat and ever more frequent disasters |

Save your current climate settings as a custom scenario from the New world dialog.

## Architecture

```
src/engine/     deterministic simulation (pure TypeScript, no DOM) — runs in the worker, tests and soak script
  world/        world generation, climate & weather, vegetation, biomes
  creatures/    genome, phenotype, behaviour (utility AI), names
  evolution/    species registry and speciation
  civ/          tribes, settlements, technology, diplomacy, territory
  simulation.ts the tick loop, births/deaths, archive, events, serialization
src/worker/     the simulation Web Worker and its message protocol
src/render/     Canvas2D renderer: painted terrain, soft overlays, sprites, weather, lighting, effects
src/ui/         React dashboard, inspector, god tools, charts, dialogs
src/client/     worker client, UI store, IndexedDB persistence
tests/          vitest suites;  scripts/  soak, profiling and world-preview tools
```

- All randomness flows through a seeded, serializable PRNG, so a seed plus the same god commands reproduces a run exactly (tested).
- The simulation runs in a Web Worker within a per-slice time budget and streams compact `Float32Array` frames; the renderer interpolates motion between frames, so the interface stays responsive at any speed.
- Saves are full simulation snapshots (IndexedDB, or exported JSON with typed arrays base64-encoded). Incompatible or corrupt autosaves are discarded and a fresh world starts.
