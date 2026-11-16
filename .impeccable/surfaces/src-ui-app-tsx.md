---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: []
---

# Surface: WORLD ZERO main screen

Scope: the single-screen app (world map + dashboard). Mode: Operate, with the world map as an Experience surface inside it. Code-led (Operate).

Audience/job: watch a simulated world live, investigate individuals/species/civilizations, intervene with god tools.

## Direction contract

THESIS: An observatory at night looking down on a living planet: the map is the light source, the instruments recede around it. Refuses the category default of a neon "sci-fi HUD" with glowing borders on every box and stat tiles for their own sake.

OWN-WORLD: Deep ocean-night neutrals (blue-black #070b12 to slate #111a26), hairline cool rules, solid-ish dark panels with a slight backdrop blur only where they float over the moving map. One live accent, a pale biolume aqua (#7fe0c4), reserved for selection, focus and the primary state; warm amber (#f0b35a) for events and warnings; species and tribe hues are data colours carried from the simulation. Inter for all UI with tabular numerals; Chakra Petch only for the wordmark and cartographic map labels.

STORY: The visitor sees the planet alive at once, reads its history in the chronicle, clicks any creature or event to follow it, and changes the world with tools whose effects appear on the map.

FIRST VIEWPORT: Full-bleed map. Top: slim bar with wordmark, world clock (year, season, day/night dial), speed transport, world actions. Left edge: vertical god-tool rail. Right: tabbed instrument column (overview, evolution, civilizations, environment, chronicle). Bottom-left: minimap with live event ticker beside it. Inspector opens as a left column when a creature is selected.

FORM: pinned by the brief; seed: none (pinned) — "premium scientific simulation interface… dark futuristic interface… subtle glowing details… elegant typography… rich data visualizations" and "a large interactive world map… live event feed".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: click an event in the chronicle and the camera flies to where it happened; follow mode keeps an individual centered with its trail.
Motion grammar: 150–250ms state transitions; camera fly-to eases out; no page-load choreography.
