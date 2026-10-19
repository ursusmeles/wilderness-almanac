# Wilderness Almanac

A vanilla JavaScript / Three.js / Vite prototype for an isometric TTRPG campaign map. The current preview includes geography, hydrology, elevation, seed-bound names, terrain types, settlements, points of interest, crossings and clustered low-poly props.

## Run

Use Node.js 24 (see `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Drag to pan, scroll/pinch or use the zoom buttons, and click a hex or select its region/XY address from the wider list, which includes POI labels such as “Meadow with a stronghold”. **New Map** creates a fresh seeded world immediately. Its settings button opens a seed input; paste a seed to replay its world and sentence-case name. **Regenerate** keeps the name, geography, elevations, terrain types, settlement footprints, POIs and crossings, while changing cosmetic terrain props and mountain ridges. Reloading preserves the current dressing variant.

The URL contains the seed, dressing variant and palette. A valid URL seed takes priority over the browser's saved seed. Icons beside the seed copy either the seed itself or a shareable map link. Links replay the current generator version; the recipient still needs access to the app. A localhost link opens the recipient's own machine.

Three editable seed colours feed the original OKLCH palette system. Name and save palettes locally; selecting a palette applies it to the map. The last seed, active colours and named palettes survive reloads in this browser. Saving an existing palette name replaces its colours. If browser storage is blocked, controls continue to work for the session.

The floating map panel occupies roughly the left 60vw, with margins on all sides. Below 760px it fills the available width inside those margins. Hex color pickers stack beside capped-width palette/save controls. The **Movement** checkbox at the palette's bottom right pauses tree sway and water waves, and remembers the choice. System reduced-motion settings also disable animation.

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
| `src/generation/props.js`              | Independent cosmetic dressing, forest links, new terrain props and sparse wave sites             |
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

Terrain follows the checked-in [Sheet snapshot](src/data/world-rules.json): coherent light/dense woodland, low wetlands near fresh water or canyons, water-biased settlements and surrounding farmland. Adjective/noun modifiers visibly change coverage while preserving suitability and at least 28% unsettled meadow/farmland. Cities roll 50% one hex, 40% two and 10% three; multi-hex footprints are connected and level. Props retain crown clustering, neighbouring forest connections and light bottom-right token clearance. Wetlands add puddles/reeds, farms add crop plots, and cities add a hall built from existing components.

The snapshot avoids a live Sheets dependency and keeps seed replay stable. Changes to vocabulary, modifiers or generation rules require a deliberate snapshot update and generator-version bump. Step 4 adds 1–4 ordinary POIs per region, plus one slot in regions with at most two settlements. POIs retain their terrain and reserve its lower-right corner. Sheet rules control location preferences, warm/cool hues and variants. Rare battlefields adjacent to defensive POIs may exceed this budget. Crossings keep the 50/30/20 bridge/ferry/neither roll near settlements, stay away from sources and mouths, and share the original bank geometry.
