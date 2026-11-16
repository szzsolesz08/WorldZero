---
name: WORLD ZERO
description: An observatory at night looking down on a living planet; the map is the light source and the instruments recede around it.
colors:
  ocean-night: "#070b12"
  panel-glass: "rgba(9, 14, 22, 0.9)"
  panel-solid: "#0a1019"
  surface-1: "#0c1420"
  surface-2: "#121c2b"
  surface-3: "#18243a"
  rule: "rgba(148, 178, 204, 0.12)"
  rule-strong: "rgba(148, 178, 204, 0.22)"
  grid: "rgba(148, 178, 204, 0.09)"
  text-1: "#e6eef4"
  text-2: "#a9b8c6"
  text-3: "#7d90a3"
  biolume-aqua: "#7fe0c4"
  biolume-aqua-soft: "rgba(127, 224, 196, 0.14)"
  biolume-aqua-hover: "#9aead3"
  aqua-ink: "#04130e"
  ember-amber: "#f0b35a"
  ember-amber-soft: "rgba(240, 179, 90, 0.14)"
  danger: "#ef6b5f"
  danger-soft: "rgba(239, 107, 95, 0.14)"
  danger-text: "#ffb3ab"
  good: "#4cc38a"
  series-1: "#3987e5"
  series-2: "#d95926"
  series-3: "#199e70"
  map-void: "#04060b"
typography:
  wordmark:
    fontFamily: "Chakra Petch, Inter Variable, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "0.16em"
  lead-figure:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "cv11, ss01"
  control:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
  axis:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 400
    fontFeature: "tnum"
  map-label:
    fontFamily: "Chakra Petch, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  seed:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.92em"
    fontWeight: 400
rounded:
  focus: "4px"
  sm: "6px"
  control: "7px"
  md: "10px"
  pill: "11px"
  dialog: "14px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "22px"
components:
  button:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.biolume-aqua}"
    textColor: "{colors.aqua-ink}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.biolume-aqua-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    height: "30px"
  button-danger:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.sm}"
    height: "30px"
  transport-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "28px"
  transport-button-active:
    backgroundColor: "{colors.biolume-aqua-soft}"
    textColor: "{colors.biolume-aqua}"
  rail-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.control}"
    width: "38px"
    height: "31px"
  rail-button-active:
    backgroundColor: "{colors.biolume-aqua-soft}"
    textColor: "{colors.biolume-aqua}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
    typography: "{typography.control}"
    height: "34px"
  tab-selected:
    textColor: "{colors.text-1}"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "21px"
  chip-war:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger-text}"
  chip-title:
    backgroundColor: "{colors.ember-amber-soft}"
    textColor: "{colors.ember-amber}"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  panel:
    backgroundColor: "{colors.panel-glass}"
    rounded: "{rounded.md}"
  dialog:
    backgroundColor: "{colors.panel-solid}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.dialog}"
  tooltip:
    backgroundColor: "{colors.panel-solid}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
---

# Design System: WORLD ZERO

## Overview

**Creative North Star: "The Night Observatory"**

WORLD ZERO is a single screen: a full-bleed painted planet with a ring of quiet instruments around it. The map is the only thing allowed to be bright. Panels are dark, nearly opaque ocean-night slabs with hairline cool rules; they blur what moves beneath them only because they float over a living map. Everything that is not the world steps back: secondary text sits at a cool slate, numbers are tabular so they can tick without jitter, and colour in the chrome is spent sparingly so the species and tribe hues on the map can carry meaning.

Density is that of a scientific instrument, not a dashboard of tiles. Information arrives as compact lists, key/value columns, small multiples of line charts and trait bars, with 13px Inter as the working voice. One live accent, a pale biolume aqua, marks what you have selected, what has focus, and the one primary action; warm amber marks events and warnings; red and green are reserved for status. The system refuses the neon sci-fi HUD: no glowing borders on every box, no stat tiles for their own sake.

Motion is state, not spectacle: 150 to 250ms transitions on the shared out-expo curve, a camera that eases out when it flies to an event, and no page-load choreography.

**Key Characteristics:**
- Full-bleed canvas map with floating instrument panels around it
- Ocean-night neutrals in three surface steps plus a translucent floating panel
- One accent (biolume aqua) reserved for selection, focus, and primary
- Amber for events and warnings; species and tribe hues are data, never decoration
- Inter with tabular numerals everywhere; Chakra Petch only on the wordmark and map labels
- Hairline cool rules instead of boxes and glows

## Colors

A cold, deep-water neutral ramp carrying one pale bioluminescent accent, one warm ember, and a small validated data palette.

### Primary
- **Biolume Aqua** (`biolume-aqua`): the only live accent. Pressed transport speed and rail tool (on its 14% soft wash), the selected tab underline, the primary button ("New world"), focus outlines, slider thumbs, progress fill, the selected scenario card, Follow mode, and the wordmark mark. Primary-button text sits on it in Aqua Ink (`aqua-ink`).

### Secondary
- **Ember Amber** (`ember-amber`): events, civilisation and warnings. Civ event icons, the creature title chip, the tech chip currently being researched, timeline dots for tribe/settlement/leader events, and meters crossing into warning (energy and hydration below 30%, eco-health 35 to 60%).

### Tertiary (status)
- **Signal Red** (`danger`): war, disaster, death, harm. Danger buttons and chips take a soft red wash with pale red text (`danger-text`); negative deltas and failing meters use the full red.
- **Growth Green** (`good`): births, healthy meters, positive deltas.

### Data series
- **Series Blue** (`series-1`), **Series Orange** (`series-2`), **Series Teal-Green** (`series-3`): the three validated chart colours. Population and rainfall take blue; deaths, temperature, mutations and carnivores take orange; births, vegetation, diversity, eco-health and herbivores take green. These three are assigned by meaning and reused consistently across charts.
- **Species and tribe hues** are generated per simulation entity (`hsl(hue, 70 to 80%, 60 to 76%)`) and travel unchanged from the map into lists, swatches, trait bars, settlement labels, and the phylogeny. They are data, owned by the simulation, never chosen for decoration.

### Neutral
- **Ocean Night** (`ocean-night`): the page background behind everything.
- **Map Void** (`map-void`): the canvas clear colour and starfield behind the planet.
- **Floating Panel** (`panel-glass`): instrument panels that float over the map (rail, dashboard, inspector, minimap, ticker items, toasts).
- **Solid Panel** (`panel-solid`): surfaces that never sit over the moving map, or need full legibility: dialogs, tooltips, the mobile overflow menu, and the 2px ring around chart points and slider thumbs.
- **Surface 1 / 2 / 3** (`surface-1`, `surface-2`, `surface-3`): resting control fill, hover fill, and pressed or completed fill respectively. Track backgrounds for meters and sliders use 2 and 3.
- **Rule** / **Rule Strong** (`rule`, `rule-strong`): hairline dividers and panel borders; strong for control borders, tooltip and dialog edges, and the topbar separator.
- **Grid** (`grid`): chart gridlines only.
- **Text 1 / 2 / 3** (`text-1`, `text-2`, `text-3`): primary values and names; secondary copy and labels; captions, units, axis text, inactive tabs.

### Named Rules
**The One Light Rule.** Biolume aqua appears only on selection, focus, and the single primary action. If it marks anything else, it is wrong.

**The Data Owns Hue Rule.** Species and tribe colours come from the simulation and are reused verbatim everywhere that entity appears. Chrome never borrows them, and they never stand in for status.

**The Three Series Rule.** Charts use `series-1`, `series-2`, `series-3` by meaning, not by order, and never introduce a fourth chrome series colour; multi-species charts use species hues instead.

## Typography

**Body Font:** Inter Variable (with Inter, system-ui, Segoe UI)
**Brand / Cartographic Font:** Chakra Petch (600)
**Mono Font:** JetBrains Mono (seeds only)

**Character:** Inter does all the work at small sizes with stylistic sets `cv11` and `ss01` on and tabular numerals on every figure; Chakra Petch is a squared, instrument-like accent that appears only where the world names itself.

### Hierarchy
- **Wordmark** (600, 16px, 0.16em tracking; 22px on the loading card): "WORLD ZERO" in the top bar and loading screen.
- **Lead figure** (600, 34px, line-height 1, -0.02em, tabular): the single headline number of a section, such as population.
- **Headline** (600, 19px, -0.01em): dialog titles.
- **Title** (600, 17px, -0.01em): the inspected creature's name; fact values in the overview grid use the same size.
- **Section** (600, 13px): section and flyout headings; chart titles step down to 12.5px.
- **Body** (400, 13px, line-height 1.45): default UI text; event descriptions and goal text at 12 to 12.5px.
- **Control** (500 to 600, 12 to 12.5px): buttons, tabs, transport.
- **Label** (400 to 500, 11 to 11.5px): captions, units, `dt` terms, chip text, legends, tooltips.
- **Axis** (400, 10.5px, tabular): chart axis ticks in Text 3.
- **Map label** (600, 11px for spaced uppercase landmass names; 9 to 14px scaling with zoom for settlement "Name · population" tags on a dark plate in the tribe hue).
- **Seed** (JetBrains Mono, 0.92em): world seeds only.

### Named Rules
**The Tabular Rule.** Every number that can change is set in tabular numerals, so live counts never shift the layout.

**The Cartographer's Face Rule.** Chakra Petch is for the wordmark and for names drawn on the map, nothing else. Headings, buttons, and numbers stay in Inter.

## Layout

The map fills the viewport (`position: fixed; inset: 0`) and every instrument floats over it with a 10px inset from the edges:

- **Top bar** (52px tall, full width): wordmark and world name, a hairline separator, the clock (day/night dial, year and season, conditions), the speed transport, a flexible spacer, live stats, and world actions. It is a dark top-down gradient with a bottom rule, not a floating panel.
- **God rail** (52px wide) on the left under the top bar; tool flyouts (300px) open to its right.
- **Dashboard** (384px; 340px below 1280px) on the right, full height under the top bar, with tabs for World, Evolution, Civs, Climate, Chronicle. It slides out horizontally when closed.
- **Inspector** (340px; 300px below 1000px) opens beside the rail when a creature is selected.
- **Minimap** (224px) bottom-left with a layer toolbar; the **event ticker** (up to 460px) sits beside it and moves right when the inspector is open.

Spacing rhythm is tight and mostly even: 2px between grouped controls, 4 to 6px inside lists and chips, 10px between floating panels and the viewport edge, 14px panel padding, 22px dialog padding. Sections in a panel are separated by a hairline rule and 14px of top padding, never by cards.

**Responsive.** Below 1280px the top-bar stats and world subtitle hide. Below 1100px the clock subline hides. Below 1000px the ticker hides. Below 860px of height the minimap hides. At **720px and below**: the top bar shrinks to 48px and drops the wordmark, separator and stats; the transport collapses to a single speed-cycle button; world actions move into a "more" menu on a solid panel; the rail collapses to one toggle and opens as a scrolling column; tooltips are dropped; the dashboard becomes a bottom sheet 50vh tall that docks to a 44px tab strip when closed; the inspector and flyouts span the width with 8px gutters; the minimap and ticker are hidden.

## Elevation & Depth

Depth is a hybrid: tonal layering does most of the work (three surface steps over ocean night), and one shared ambient shadow lifts anything that floats over the map. Blur is a material property of floating panels, not decoration.

### Shadow Vocabulary
- **Float** (`0 12px 32px -12px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.35)`): every floating panel, tooltip, and the mobile actions menu.
- **Sheet** (`0 30px 80px -20px rgba(0,0,0,0.8)`): modal dialogs only, over a `rgba(2,4,8,0.66)` backdrop with a 3px blur.
- **Focus halo** (`0 0 0 3px rgba(127,224,196,0.15)`): text inputs on focus, with the border turning aqua.

### Named Rules
**The Blur Over Motion Rule.** Backdrop blur (10px, saturate 1.1) is applied only to panels floating over the live map. Dialogs and tooltips are solid.

**The No Glow Rule.** Borders are hairline rules in cool slate. Nothing in the chrome glows; glows belong to the map (fires, settlement lights at night, torches).

## Shapes

Gently rounded and consistent: 6px on buttons and inputs, 7px on rail buttons, rows, tabs (top corners only) and tooltips, 10px on floating panels and scenario cards, 14px on dialogs, 11px pills for chips. Meters, trait tracks and segment bars are fully rounded capsules (4 to 8px). Swatches are 10px circles (species) or 3px-rounded squares (categories) with a dark 2px halo so they read on any surface. Selection markers are 2px bars: the rail's left edge indicator and the tab underline, both in aqua with 2px rounded ends.

## Components

### Buttons
Quiet and solid; they feel like instrument keys rather than calls to action.
- **Shape:** gently rounded (6px), 30px tall (26px small), 1px Rule Strong border on Surface 1.
- **Primary:** Biolume Aqua fill with Aqua Ink text at 600; one per view ("New world"). Hover lightens to `biolume-aqua-hover`.
- **Hover / Focus:** hover lifts to Surface 2 with a slightly brighter border; active nudges down 0.5px; focus-visible draws a 2px aqua outline offset 2px. Transitions 160ms.
- **Ghost:** transparent, Text 2, filling to Surface 2 on hover.
- **Danger:** red-tinted border with pale red text; hover takes the soft red wash.
- **Icon:** square 30px, Lucide icons at 13 to 16px, stroke 2.

### Transport
A segmented well (Surface 1, 1px rule, 8px radius, 3px padding) holding pause and speed buttons (28px tall). The pressed speed takes the aqua soft wash with aqua text; a muted ticks-per-second readout ends the group.

### God Rail
A floating panel column of 38x31px icon buttons in groups divided by hairlines. Hover fills Surface 2; the active tool takes the aqua wash plus a 2px aqua bar on the left edge. Tooltips (solid panel, 12px, with an 11px Text 3 hint line) appear to the right after hover; flyouts list options as rows with a swatch, label and hint, the pressed option outlined in aqua at 45%.

### Tabs
Equal-width, 34px, 600 12px text in Text 3; hover brightens and fills Surface 1; the selected tab turns Text 1 with a 2px aqua underline inset 10px each side.

### Chips
- **Style:** 21px pills (11px radius), 11px 500 text, Surface 2 fill, Text 2, 1px rule.
- **Variants:** war (soft red), alliance (soft series blue), tech done (Surface 3, Text 1), tech in progress (amber outline and text), title (amber wash, 19px).

### Lists, key/value and trait bars
- **Rows:** 12px swatch, name with an 11px caption, right-aligned tabular value with caption; hover fills Surface 1; no borders.
- **Key/value lists:** two columns, Text 3 terms, right-aligned tabular values, 12px, 3px row gap.
- **Trait bars:** 96px label, 6px capsule track on Surface 2 filled in the entity's colour, a 2px Text 1 tick marking the species mean, and a 34px tabular value.
- **Meters:** 4px capsule tracks; fill colour moves good, amber, red by threshold.

### Event rows
22px rounded-square icon tile tinted by category (species/evolution violet, civ amber, war/disaster red, climate blue, creature orange, god neutral), a 600 12px title, a 12px Text 2 description, and an 11px Text 3 timestamp. Clicking flies the camera to the event. Ticker items are the same row on a floating panel, entering with an 8px rise over 320ms.

### Inputs / Fields
- **Style:** 32px, Surface 1, 1px Rule Strong, 6px radius.
- **Focus:** border turns aqua with a 3px aqua halo at 15%.
- **Sliders:** 4px Surface 3 track, 14px aqua thumb with a solid-panel ring; label left, tabular value right.
- **Segmented control:** Surface 1 well, 24px buttons; pressed takes Surface 3 and Text 1 (neutral, not aqua).

### Panels and dialogs
- **Floating panel:** `panel-glass`, 1px rule, 10px radius, float shadow, 10px blur. Internal padding 14px.
- **Dialog (sheet):** solid panel, 14px radius, Rule Strong border, up to 980px wide; head, scrollable body and foot each separated by rules, 22px horizontal padding. Scenario cards inside are 10px-radius tiles with an 86px painted preview; the chosen one gets an aqua border.

### Charts
Line charts, a stacked species area, a segmented diet bar and a phylogenetic tree, all hand-drawn SVG. Gridlines in `grid`, about three ticks per axis, 10.5px tabular axis labels in Text 3, time axes labelled in a single unit. The latest value is marked with a 4px dot ringed in the solid panel colour and a direct 11px 600 label; hover draws a Text 3 crosshair and a solid tooltip with series swatches as 10x2px lines. Legends sit below with 12x2px line keys or 9px box keys. Every chart offers a table toggle that reveals the data as a compact tabular table.

### Inspector
A floating column with a 56px rounded portrait, the creature name as Title with an optional amber title chip, a muted lineage line, a Locate and Follow action row (Follow turns aqua when on), a current-goal card, two-column vital meters, trait bars, relationships, and a timeline whose dots are coloured by event kind (green birth, red danger, orange kill, amber social). It slides in 12px from the left over 220ms.

### The map
The world is painted, not tiled: biome colours warped with value noise and grain into an 8px-per-tile texture, with soft vegetation and snow overlays. Territory reads as a translucent tribe-hue wash bounded by contour lines that stay faint at overview zoom (30% alpha) and sharpen as you close in, adding a soft 5px halo past 1.8x the fit zoom. Creatures render as short oriented streaks in their species hue at overview zoom, so herds read as flowing groups, and switch to drawn sprites past 4.5x zoom, with small state marks (tribe banner dot, notable ring, hunting arc, sleep crescent, courting heart) appearing at higher zoom. Settlements grow from hue dots to clustered huts, walls, and towers, ringed in their tribe hue. Weather draws clouds and precipitation; day and night are a multiply wash that cools to blue at night and warms at dusk, with additive warm glows on settlements and torches after dark. Selection is a pulsing double ring with a fading trail; hover is a thin white ring. Labels follow the cartographer's face rule. A vignette closes the frame.

## Do's and Don'ts

### Do:
- **Do** reserve Biolume Aqua (`#7fe0c4`) for selection, focus, and the one primary action per view.
- **Do** set every changing number in tabular numerals.
- **Do** carry a species or tribe colour unchanged from the map into every list, swatch, bar, label and chart where that entity appears.
- **Do** assign chart colours by meaning from the three series tokens, with direct labels on the latest value and a table toggle.
- **Do** blur panels only when they float over the live map; use the solid panel for dialogs, tooltips and menus.
- **Do** separate sections with a hairline rule and spacing, not with nested cards.
- **Do** keep state transitions between 150 and 260ms on `cubic-bezier(0.16, 1, 0.3, 1)` and let the camera ease out on fly-to.
- **Do** collapse to the bottom sheet, rail toggle and overflow menu at 720px and below.

### Don't:
- **Don't** add glowing borders, neon outlines or coloured box shadows to chrome; glow belongs to the map.
- **Don't** build stat tiles for their own sake; numbers live in fact grids, key/value lists and lead figures.
- **Don't** use Chakra Petch for headings, buttons or numbers.
- **Don't** use species or tribe hues as status colours, or status colours as data.
- **Don't** add page-load choreography or animate anything that is not a state change.
- **Don't** introduce a second accent; amber is for events and warnings, not emphasis.
