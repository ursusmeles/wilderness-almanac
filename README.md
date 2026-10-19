# Wilderness Almanac

A vanilla JavaScript / Three.js / Vite prototype for an isometric TTRPG campaign map. The current preview includes geography, hydrology, elevation, seed-bound names, terrain types, settlements, points of interest, crossings and clustered low-poly props.

## Run

Use Node.js 24 (see `.nvmrc`), then:

```sh
npm ci
npm run dev
```

The homepage shows your locally saved campaigns. **New campaign** generates and opens a random world; **Import campaign** adds a campaign from a Wilderness Almanac JSON export. Each campaign has a tile icon rendered from its world and palette, an editable name (initially the map name), creation date, seed, palette name, settlement/POI counts and open-water/land percentages. River channels are excluded from that ratio. Edit a name and press Enter or click away to save it. The row's icons copy the seed, share the map, enter the campaign, download its JSON or delete it. Deletion can be undone, including after reload, until another campaign is deleted. Hover or keyboard-focus the tile icon to reveal its upper-right refresh button (always visible on touch screens). Refresh chooses a different random hex, excluding empty meadows and ocean/lake tiles; forests, mountains, rivers, wetlands, farms, settlements and meadow POIs are eligible. The chosen hex survives reload and JSON export/import.

Downloads use `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`, with a filename-safe name and the local export date. Files preserve the campaign's creation date, name, seed, generator version, dressing variant, selected icon hex, name-edit state and palette colours/name. They replay the same world within the supported generator version; incompatible versions are rejected. Imports create separate local saves without overwriting existing campaigns. Campaigns live in this browser, independently of GitHub; export/import carries them between computers. The previously saved map becomes a campaign on first launch (using its migration date as the creation date).

On the map, drag to pan, scroll/pinch or use the zoom buttons, and click a hex or select its region/XY address from the wider list, which includes POI labels such as “Meadow with a stronghold”. **New Map** replaces the world in the current campaign slot, preserving its ID, creation date and palette. Unedited campaign names follow the new map name; explicitly edited names are retained. Each replacement resets cosmetic dressing and chooses a new eligible icon hex. Its settings button opens a seed input; paste a seed to replay its world and sentence-case name. **Regenerate** keeps the name, geography, elevations, terrain types, settlement footprints, POIs and crossings, while changing cosmetic terrain props and mountain ridges. Reloading preserves the active campaign and dressing variant. **Return to menu**, below Movement, saves the campaign and opens the homepage.

The URL contains the seed, dressing variant and palette. A valid URL seed takes priority over the browser's saved seed. Icons beside the seed copy either the seed itself or a shareable map link. Links replay the current generator version; the recipient still needs access to the app. A localhost link opens the recipient's own machine.

Three editable seed colours feed the original OKLCH palette system. Name and save palettes locally; selecting a palette applies it to the map. The last seed, active colours and named palettes survive reloads in this browser. Saving an existing palette name replaces its colours. If browser storage is blocked, controls continue to work for the session.

The desktop map panel occupies roughly the left 60vw, with margins on all sides. On phones and compact landscape screens, the map view fills the viewport, with a compact header, floating zoom controls and a collapsed **Palette & settings** panel. Opening that panel reveals palette editing, Movement and Return to menu; the header’s back arrow also returns to the menu. The map starts at a closer 1.6× zoom on mobile, and all zoom controls, wheel and pinch can reach 12× (previously 4.5×). The expand icon fills the browser viewport with the map, retaining zoom and exit controls. Browser chrome stays in place; tap Exit or press Escape to restore the normal view. View changes retain the map and current zoom/pan. Returning to desktop restores the full palette controls. Hex color pickers stack beside capped-width palette/save controls. The **Movement** checkbox at the palette's bottom right pauses tree sway and water waves, and remembers the choice. System reduced-motion settings also disable animation.

```sh
npm test
npm run build
npm run format:check
```

No backend, account, API key, or environment variables are required. Three.js remains pinned to **0.160.1**.

## Structure

| Path                                   | Responsibility                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/main.js`                          | UI controller, New Map/Regenerate, selection and palette controls                                |
| `src/map-data.js`                      | Regular 469-cell hex, six compact regions, world/local coordinates; retained legacy topology     |
| `src/generation.js`                    | Public API including the dormant original `makeLayout(seed)`                                     |
| `src/generation/world.js`              | Versioned, JSON-compatible world pipeline and independent dressing variants                      |
| `src/generation/seed.js`               | String seeds, named random streams and coherent noise                                            |
| `src/generation/geography.js`          | Coast selection, connected ocean growth, bays, peninsulas, islands/archipelagos                  |
| `src/generation/hydrology.js`          | Lakes, drainage routes, tributary joins, flow and river widths                                   |
| `src/generation/river-routing.js`      | Space-aware bends for long straight river reaches                                                |
| `src/generation/elevation.js`          | Mountain ranges first, coherent levels 0–4, island relief, cliffs, hills and canyons             |
| `src/generation/mountain-surfaces.js`  | Original connected ridge meshes on level-4 tiles, with restrained silhouettes and shared seams   |
| `src/data/world-rules.json`            | Versioned Sheet snapshot: terrain/POI rules and 30-by-30 name vocabulary                         |
| `src/generation/map-names.js`          | Seed-bound names and bounded, visible terrain modifiers                                          |
| `src/generation/terrain-types.js`      | Coherent woodland, wetlands, open-land minimum and settlement-adjacent farmlands                 |
| `src/generation/points-of-light.js`    | Water-biased settlement placement and connected city footprints                                  |
| `src/generation/props.js`              | Independent cosmetic dressing, terrain props and sparse wave sites                               |
| `src/generation/forest-props.js`       | Connected forest canopies, shared tree spacing and reserved clearances                           |
| `src/generation/spatial.js`            | Shared hex distance fields                                                                       |
| `src/generation/points-of-interest.js` | Sparse weighted POIs, wilderness budgets and bank-aware settlement crossings                     |
| `src/generation/presentation.js`       | Pure adapter from world/dressing data to bank surfaces and render descriptors                    |
| `src/generation/river-surfaces.js`     | Shared numerical bank/island field and clipped mesh data                                         |
| `src/generation/legacy.js`             | Original elevation, forests, mountain ranges, props and bridge/ferry rules                       |
| `src/rendering/map-renderer.js`        | Three.js meshes, camera, pointer interaction and disposal; accepts data, never generates a world |
| `src/rendering/ambient-motion.js`      | Anchored tree sway with a periodic gust, and looping water-wave shaders                          |
| `src/rendering/poi-props.js`           | Low-poly corner dioramas using existing material roles and building components                   |
| `src/ui/map-link.js`                   | URL replay, clipboard helper and POI-aware coordinate labels                                     |
| `src/palette.js`                       | Three-seed OKLCH colours with subtle warm/cool prop variations                                   |
| `src/ui/storage.js`                    | Validated browser preferences and named palettes                                                 |
| `src/ui/campaigns.js`                  | Versioned campaign records, local storage, validated JSON import/export and metadata             |
| `src/ui/campaign-menu.js`              | Campaign list, editable names, tile thumbnails and file/clipboard actions                        |
| `tests/`                               | Legacy regression tests and world-generation invariants                                          |
| `reference/hex-smooth-riverlands.html` | Untouched original visual/code snapshot                                                          |
| `docs/PROJECT_STATE.md`                | Design decisions, source references, algorithm details and limits                                |

```js
import { generateWorld, generateDressing } from './src/generation.js';
import { prepareMap } from './src/generation/presentation.js';

const world = generateWorld('the-same-seed');
const dressing = generateDressing(world, 0);
const renderData = prepareMap(world, dressing);
// All three are plain data; none depends on Three.js, the DOM or browser storage.
```

A seed replays the world within `generatorVersion: 6`. The map uses a regular radius-12 hex of 469 cells, with about 18 km between centers. Elevation places connected level-4 mountain ranges first, then builds lower slopes around them and away from water. Islands use levels 0–3; occasional cliffs, small hills and bending dry canyons add fantasy relief. Levels 0–3 rise in restrained 0.22-unit steps; level 4 uses the same base height as level 3, with broad low-poly mountain props on top. Rivers and open water stay at level 0. Water clipping, matched river/land bevels, winding rivers and rounded mouths remain intact.

Terrain follows the checked-in [Sheet snapshot](src/data/world-rules.json): coherent light/dense woodland, low wetlands near fresh water or canyons, water-biased settlements and surrounding farmland. Adjective/noun modifiers visibly change coverage while preserving suitability and at least 28% unsettled meadow/farmland. Cities roll 50% one hex, 40% two and 10% three; multi-hex footprints are connected and level. Forest props are sampled across connected, equal-height woodland as irregular canopy patches, with shared spacing across hex boundaries. Neighbouring crowns can meet naturally, without straight linking rows; sparse tiles, glades and light bottom-right token clearance remain. Wetlands add puddles/reeds, farms add crop plots, and cities add a hall built from existing components.

The snapshot avoids a live Sheets dependency and keeps seed replay stable. Changes to vocabulary, modifiers or generation rules require a deliberate snapshot update and generator-version bump. Step 4 adds 1–4 ordinary POIs per region, plus one slot in regions with at most two settlements. POIs retain their terrain and reserve its lower-right corner. Sheet rules control location preferences, warm/cool hues and variants. Rare battlefields adjacent to defensive POIs may exceed this budget. Crossings keep the 50/30/20 bridge/ferry/neither roll near settlements, stay away from sources and mouths, and share the original bank geometry.
