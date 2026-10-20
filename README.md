# Wilderness Almanac

A vanilla JavaScript / Three.js / Vite prototype for an isometric TTRPG campaign map. The current preview includes geography, hydrology, elevation, seed-bound names, terrain types, settlements, points of interest, crossings and clustered low-poly props.

## Run

Use Node.js 24 (see `.nvmrc`), then:

```sh
npm ci
npm run dev
```

The homepage shows your locally saved campaigns. **New campaign** generates and opens a random world; **Import campaign** adds a campaign from a Wilderness Almanac JSON export. Each campaign has a tile icon rendered from its world and palette, an editable name (initially the map name), creation date, seed, palette name, settlement/POI counts and open-water/land percentages. River channels are excluded from that ratio. Edit a name and press Enter or click away to save it. The row's icons copy the seed, share the map, enter the campaign, download its JSON or delete it. Deletion requires a confirmation naming the campaign. Undo deletion is available until the next campaign action; entering, renaming, icon controls, copying/sharing, exporting, creating or importing clears it, including its saved recovery record. Hover or keyboard-focus the tile icon to reveal its upper-right refresh button. On mobile, tap the tall tile preview to toggle that control; tapping elsewhere dismisses it. Initial icons are selected uniformly from settlement and POI tiles. Refresh rolls 50/50 between settlement/POI tiles and other eligible terrain, then chooses uniformly within that pool. It avoids the current hex and excludes empty meadows and ocean/lake tiles; forests, mountains, rivers, wetlands and farms remain eligible. If a pool has no alternative, refresh uses the other pool. The chosen hex survives reload and JSON export/import.

Downloads use `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`, with a filename-safe name and the local export date. Files preserve the campaign's creation date, name, seed, generator version, dressing variant, selected icon hex, name-edit state and palette colours/name. They replay the same world within the supported generator version; incompatible versions are rejected. Imports create separate local saves without overwriting existing campaigns. Campaigns live in this browser, independently of GitHub; export/import carries them between computers. The previously saved map becomes a campaign on first launch (using its migration date as the creation date).

On the map, drag to pan, scroll/pinch, use the zoom buttons or press **+ / =** and **−**, and click a hex or select its region/XY address from the wider list, which includes POI labels such as “Meadow with a stronghold”. **New Map** replaces the world in the current campaign slot, preserving its ID, creation date and palette. Unedited campaign names follow the new map name; explicitly edited names are retained. Each replacement resets cosmetic dressing and chooses a new eligible icon hex. Its settings button opens a seed input; paste a seed to replay its world and sentence-case name. **Regenerate** keeps the name, geography, elevations, terrain types, settlement footprints, POIs and crossings, while changing cosmetic terrain props and mountain ridges. Reloading preserves the active campaign and dressing variant. **Return to menu**, beside the settings toggle, saves the campaign and opens the homepage even when settings are collapsed.

The URL contains the seed, dressing variant and palette. A valid URL seed takes priority over the browser's saved seed. Icons beside the seed copy either the seed itself or a shareable map link. Links replay the current generator version; the recipient still needs access to the app. A localhost link opens the recipient's own machine.

Three editable seed colours feed the opinionated OKLCH palette system. Ground seed brightness has the strongest influence, water a moderate influence and elements a restrained influence. Near-black tile sides, trunks and recesses retain their original shading; surface lightness and depth stay coordinated. Automatic material contrast checks separate water/shorelines, foliage and selection highlights, including identical or extreme seed colours. Precise RGB gamut fitting retains as much saturation as possible. Interface colours retain their own readable dark-theme scale. The preset terrain colours remain close to their established appearance.

Nine built-in palettes are available. Dusk & gold, Ember coast and Moss & bone retain their original colours; Alien orchard is removed from the preset list. “Verdant Kingdoms” is the natural green/blue preset. New campaigns start with Forbidden Lands; existing campaigns retain their saved colours.

| Palette          | Ground    | Water     | Elements  |
| ---------------- | --------- | --------- | --------- |
| Dusk & gold      | `#282039` | `#237D89` | `#E5B96E` |
| Ember coast      | `#322333` | `#2A6775` | `#ED8965` |
| Moss & bone      | `#1E302C` | `#477480` | `#DAD2A4` |
| Verdant Kingdoms | `#66945C` | `#397CAF` | `#6CAD48` |
| Thronefall       | `#000000` | `#243F4A` | `#FFB600` |
| Glacial mint     | `#C7FFEE` | `#477480` | `#99C1F1` |
| Autumn copper    | `#633F32` | `#315F70` | `#E26D32` |
| Sand & sage      | `#E6CB8A` | `#3F8D91` | `#618253` |
| Forbidden Lands  | `#CDAB8F` | `#0B365E` | `#11B329` |

Thronefall pairs a pure-black ground seed with saturated warm gold and slate water. Glacial mint uses the supplied reference colours exactly. Swatches show the seed colours; the opinionated material scale still derives readable rendered shades.

Settlement walls use brighter, nearly neutral plaster with a subtle palette tint. Town/city roofs reuse each building’s cosmetic seed to choose a related clay, ochre, slate, timber or original-palette finish. Village roofs retain straw with smaller variations. These are colour changes; map generation, dressing placement, shadows and lighting remain unchanged. Keyboard zoom operates only while the map is open, outside text fields/dropdowns and dialogs, and leaves browser modifier shortcuts alone. Name and save palettes locally; selecting a palette applies it to the map. The last seed, active colours and named palettes survive reloads in this browser. Saving an existing palette name replaces its colours. If browser storage is blocked, controls continue to work for the session.

The desktop map panel occupies roughly the left 60vw, with compact 6–12px margins and tighter header/status/palette padding. Phones and compact landscape screens use the full viewport, with a compact header and floating zoom controls. Maps start at 1.68× zoom on desktop (one button step above 1.4×) and 1.6× on mobile; buttons, wheel and pinch can reach 12×. New Map and seeded replacements preserve the current zoom and pan within the campaign. Opening another campaign applies the default view. The expand icon fills the browser viewport with the map, retaining zoom and exit controls. Browser chrome stays in place; tap Exit or press Escape to restore the normal view.

Settings can collapse on every screen size. The compact toolbar keeps three small hex swatches and the palette selector on the left, with Open settings and Return to menu on the right. Palette creation and the **Wind is ON/OFF** switch appear only when expanded. The open/collapsed choice is saved across campaigns, viewport changes and reloads; first visits start expanded on desktop and collapsed on mobile. The Wind switch pauses tree sway, swamp reeds/grass and water waves, and remembers its state. Its filled status light indicates ON; an outlined light indicates OFF. Keyboard and screen-reader switch semantics remain available, and system reduced-motion preferences still disable animation.

The right status console shows hex/region counts at rest and short region/local coordinates such as `1/1,2` when hovering or selecting a hex. Palette changes/creation, dressing regeneration, new maps, seed/link copying and Wind changes appear for 3.5 seconds before returning to coordinates or counts. Action feedback uses a separate live announcement; hover updates stay silent for screen readers.

```sh
npm test
npm run build
npm run format:check
```

No backend, account, API key, or environment variables are required. Three.js remains pinned to **0.160.1**.

## Interface

Geist Pixel Square is used for the wordmark, titles, all campaign metadata values, seeds and status details; Geist Sans handles body text and controls. Both WOFF2 fonts are self-hosted and preloaded, with the SIL Open Font License included in `public/fonts/`. A render-blocking stylesheet and inline dark-page defaults prevent the unstyled white-page/oversized-logo flash without a loading screen. The menu tagline is “DM toolbox for sandbox RPG campaigns”; the new-campaign slot reads “An unexplored world”.

The menu and campaign cards use a fixed dusk-and-gold theme, independent of campaign palettes; terrain previews and maps retain their campaign colours. The hex mark is removed, and the title/tagline form a tightly spaced, left-aligned heading group. Desktop actions occupy a two-column, three-row grid: Enter spans the top four cells, with export and delete below. Mobile cards use a tall terrain preview beside stacked title, metadata, seed and actions. Refresh stays hidden until the preview is tapped or reached by keyboard.

Pixelarticons supplies the UI symbols through a local 17-icon SVG sprite (about 3.4 KB), with its MIT license and source revision in `public/icons/`. Only selected paths are included; no icon dependency, icon font or CDN is loaded. Icons retain their native 24px grid and inherit interface colours. Corners use shared 2/3/4px radius tokens. Mobile campaign and map seed rows keep copy/share alongside the seed; long seeds visually truncate, retain their full tooltip, and copy/share their complete values. The delete confirmation only asks whether to remove the named campaign from this device.

Map-view titles use 24px Geist Pixel on desktop and 20px on mobile. Seed copy/share glyphs use a compact 16px size across the menu and map, retaining their existing click/touch targets.

Controls share a 12px Geist Sans label style and 40px desktop height, with a 32px compact copy/share/refresh variant. Mobile, compact landscape and touch controls use 44px targets. Campaign Enter retains its larger grid span, while titles and metadata retain Geist Pixel. Desktop region and palette dropdowns share a column grid and end at the same horizontal position. The status row has 14px top padding on desktop and 12px on mobile to separate it from the map.

Campaign cards use 12px padding on desktop and 8px on mobile. The map's coordinate dropdown stays at the left of a single status row, with hex/region counts and console feedback aligned right; the visible pan/zoom instructions are removed. The new-map settings icon is 18px to balance its denser shape against the other icons, and palette hex values use Geist Pixel Square.

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
| `src/generation/forest-types.js`       | Seed-bound European forest names and mixed woodland boundaries                                   |
| `src/generation/settlement-props.js`   | Exterior city walls, occasional village fences and narrow placement reservations                 |
| `src/generation/spatial.js`            | Shared hex distance fields                                                                       |
| `src/generation/points-of-interest.js` | Sparse weighted POIs, wilderness budgets and bank-aware settlement crossings                     |
| `src/generation/presentation.js`       | Pure adapter from world/dressing data to bank surfaces and render descriptors                    |
| `src/generation/river-surfaces.js`     | Shared numerical bank/island field and clipped mesh data                                         |
| `src/generation/legacy.js`             | Original elevation, forests, mountain ranges, props and bridge/ferry rules                       |
| `src/rendering/map-renderer.js`        | Three.js meshes, camera, pointer interaction and disposal; accepts data, never generates a world |
| `src/rendering/ambient-motion.js`      | Anchored tree sway with a periodic gust, and looping water-wave shaders                          |
| `src/rendering/settlement-props.js`    | Shared building components, straw roofs, taller city houses, fences and partial walls            |
| `src/rendering/poi-props.js`           | Low-poly corner dioramas using existing material roles and building components                   |
| `src/ui/map-link.js`                   | URL replay, clipboard helper and POI-aware coordinate labels                                     |
| `src/palette.js`                       | OKLCH conversion, gamut fitting, contrast math and interface colours                             |
| `src/map-palette.js`                   | Responsive map material families, protected dark anchors and contrast safeguards                 |
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

Forest hex labels include a European tree type, shared by the whole connected deciduous or evergreen cluster across density and elevation changes. Deciduous names are oak, beech, birch and ash; evergreen names are pine, spruce, fir and **Taiga**. Taiga is reserved for clusters of at least seven connected evergreen hexes and stands alone without a density prefix or “forest” suffix. At deciduous/evergreen boundaries, some hexes contain both silhouettes, keeping their cluster's primary name. Names and mixed-hex choices stay fixed through Regenerate. Deciduous trees have slightly broader size variation and subtle foliage hue/lightness tones; evergreen styling stays unchanged.

Villages have two to four cottages with light, textured straw roofs, the occasional straw-roof tower and a 35% chance of a short wooden fence. They average about one fewer building than before. Towns retain their existing dressing. Cities have more compact houses, mostly two or three storeys high, and no scattered grass or rocks. A partial stone wall occupies two or three exterior edges of the city footprint, avoiding shared interior edges, buildings, POIs and token space. Swamp reeds and grass bend with the trees' wind cycle, with anchored roots and a gentler sway. These cosmetic changes apply to existing campaigns on reload without changing settlement locations or world geography.

Encampments, ruins, lairs, dungeons, mystic sites and battlefields use larger corner models with matching clearance. Ruins have broken gates, columns and tower walls; cave and dungeon openings are recessed inside real hollow frames. Mines add timber supports, rails and a cart. Battlefields always have a banner and one to five larger skulls. Strongholds vary between a fortified keep, round-tower fortress and walled hall. Hex labels identify cave lairs, nests, mines, dungeon entrances, portals, altars and standing stones. Mountain footings follow the sampled slope and use the ridge palette instead of a uniform stone cylinder.

The snapshot avoids a live Sheets dependency and keeps seed replay stable. Changes to vocabulary, modifiers or generation rules require a deliberate snapshot update and generator-version bump. Step 4 adds 1–4 ordinary POIs per region, plus one slot in regions with at most two settlements. POIs retain their terrain and reserve its lower-right corner. Sheet rules control location preferences, warm/cool hues and variants. Rare battlefields adjacent to defensive POIs may exceed this budget. Crossings keep the 50/30/20 bridge/ferry/neither roll near settlements, stay away from sources and mouths, and share the original bank geometry.
