# Development guide

Wilderness Almanac is a client-side application written in vanilla JavaScript ES modules, with Vite and Three.js. World generation and numeric geometry are independent of the DOM and renderer. There is no application server, database, account system or runtime connection to the source spreadsheet.

Read [PROJECT_STATE.md](PROJECT_STATE.md) for generation and visual constraints, and [AGENTS.md](../AGENTS.md) for repository working instructions.

## Setup and checks

Use Node.js 24 or later (`.nvmrc` selects 24):

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run format:check
```

`npm test` runs the Node test suite. Generation changes require the full suite; runnable source changes require a production build. Use `npx prettier --write <changed-files>` to format touched files. `npm run preview` serves the production build. Vite currently reports a bundle-size advisory; bundle splitting is deferred.

Inspect visual changes in a real browser at desktop and phone widths. Check map selection, tool panels, viewport expansion and browser errors when changing workspace layout. Pointer-driven mobile emulation does not establish physical touch/pinch correctness.

## Code map

| Path                                                                                             | Responsibility                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `index.html`, `src/styles.css`                                                                   | Document, fixed menu theme, campaign palette styling and responsive workspace layout  |
| `src/main.js`                                                                                    | Application lifecycle, active campaign, map actions, selection and palette controls   |
| `src/map-data.js`                                                                                | Seed-independent 469-cell topology, regions and coordinates                           |
| `src/generation.js`                                                                              | Public world-generation and campaign-editing exports                                  |
| `src/generation/world.js`                                                                        | Versioned world pipeline and independent dressing variants                            |
| `src/generation/seed.js`, `hex.js`, `spatial.js`                                                 | Named random streams, noise, axial geometry and distance fields                       |
| `src/generation/geography.js`, `hydrology.js`, `river-routing.js`, `elevation.js`                | Coastlines, islands, lakes, drainage, river bends and relief                          |
| `src/generation/map-names.js`, `terrain-types.js`, `points-of-light.js`, `points-of-interest.js` | Names, biomes, settlements and POIs                                                   |
| `src/generation/props.js`, `forest-props.js`, `forest-types.js`, `settlement-props.js`           | Cosmetic dressing and connected forest placement                                      |
| `src/generation/prop-placement.js`, `crossings.js`, `ridge-surface.js`                           | Shared footprint/spacing rules, crossing sites and continuous mountain meshes         |
| `src/generation/presentation.js`, `river-surfaces.js`, `mountain-surfaces.js`, `math.js`         | Plain numeric surfaces and render descriptors                                         |
| `src/generation/campaign-world.js`, `hex-edits.js`                                               | Validated sparse edits, connection repair, local rerolls and dressing locks           |
| `src/rendering/`                                                                                 | Three.js scene, batched meshes, picking, POI/settlement components and ambient motion |
| `src/palette.js`, `src/map-palette.js`                                                           | Palette presets, UI theme and OKLCH material roles/contrast safeguards                |
| `src/ui/campaigns.js`, `campaign-menu.js`                                                        | Campaign persistence/import/export, library and tile-icon actions                     |
| `src/ui/hex-inspector.js`, `panels.js`, `tile-preview.js`                                        | Inspector editing, responsive panel state and shared still previews                   |
| `src/ui/storage.js`, `map-link.js`, `map-console.js`                                             | Preferences, replay URLs, clipboard and action feedback                               |
| `src/data/world-rules.json`                                                                      | Checked-in rule and naming snapshot with source attribution                           |
| `public/fonts/`, `public/icons/`                                                                 | Self-hosted fonts, selected SVG icons and their licenses                              |
| `tests/`                                                                                         | Generation, numeric geometry, palette, editing, persistence and replay tests          |

Paths grouped after a full filename in the table are relative to the same directory.

## Generation and rendering boundary

```js
import { generateWorld, generateDressing } from './src/generation.js';
import { prepareMap } from './src/generation/presentation.js';

const world = generateWorld('the-same-seed');
const dressing = generateDressing(world, 0);
const renderData = prepareMap(world, dressing);
```

These three results are plain data. Run the example from a module at the repository root. `generateWorld` owns geography and feature placement; `generateDressing` owns cosmetic variants; `prepareMap` builds numeric mesh descriptors without mutating the world. Campaign edits are resolved over the generated base by `campaignWorld` and `campaignDressing`.

Use named random streams so changes to one stage do not consume another stage's randomness. Keep seed replay and JSON compatibility deliberate. A change to world-generation rules, vocabulary or naming modifiers requires a generator-version decision and a corresponding snapshot update when applicable. Pure refactors should preserve generated data, dressing and geometry exactly. Cosmetic changes must respect saved dressing snapshots and locks.

The renderer batches props by material/shadow role while retaining hex identity for picking. It owns GPU resources, resize observers, listeners and cleanup. The menu and Inspector share one still preview renderer; avoid adding animated scenes or per-hex WebGL contexts. Three.js is intentionally pinned to `0.160.1`.

## Campaigns, persistence and links

- `wilderness-almanac:campaigns-v1` stores local campaign records and recoverable deletion state. `hex-sandbox:map-v1` stores the active campaign ID, map preferences and custom palettes through the storage module. Keep older campaign-field and single-map preference migration support.
- Campaign records carry identity, creation time, editable-name state, generator version, seed, dressing variant, three palette seeds/name and icon hex. New Map replaces that record's world while preserving identity, creation time and palette. A name follows the generated map name until explicitly renamed.
- Export envelope version 2 includes version-1 sparse hex edits and bounded frozen dressing descriptors. Version-1 envelopes still import. Validate dates, lengths, coordinates, enums, finite dimensions and prop limits; reject unsupported generator versions and imports over 4 MB. Never accept arbitrary mesh data from imports.
- Downloads use a filename-safe campaign name and local date: `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`. Import adds a separate local campaign. The palette travels with that campaign; the full custom-palette library does not.
- Map links contain `seed`, `variant` and three colour seeds, with URL values taking precedence over local preferences. They omit hex edits, visited status and locks. Changing the map updates the URL without adding browser-history entries.
- Handle blocked/full browser storage without losing the active in-memory session, and offer JSON export when saving fails. Storage capacity and the import-size limit are independent.

Deletion requires confirmation. Undo deletion expires on the next campaign action, including entering, renaming, icon changes, copying/sharing, exporting, creating or importing. Initial tile icons choose a settlement/POI; refresh rolls 50/50 between that pool and other eligible terrain, excluding the current tile, empty meadows and open water, with fallback when a pool is empty.

## Interface conventions

Use Geist Sans for body copy and controls, and Geist Pixel Square for titles, metadata values, seeds and status details. Fonts are local and preloaded. Keep the render-blocking stylesheet and inline dark defaults in `index.html` so the initial paint does not flash white or unstyled content.

The campaign library has a fixed dusk-and-gold theme. Map controls follow their campaign palette. Keep shared 2/3/4px radius tokens, 12px control labels, 40px desktop controls and 44px touch targets; compact icon controls retain their established target sizes. Use only the needed Pixelarticons paths in the local SVG sprite and retain its source/license notes.

The workspace root is `#campaign-workspace`. Desktop places the map left and tools right; panels can reorder, minimise vertically or fold into rails. Mobile keeps the map section at viewport height and places Inspector then Tracker below it, at full width. Expansion fills the browser viewport using CSS, with browser chrome retained. Preserve settings/panel preferences across campaigns and screen sizes.

Wind controls share accessible switch/diode semantics with visited status. Respect reduced-motion preferences, pause animation in hidden documents, and keep transient action announcements separate from silent hover-coordinate updates.

## Licensing

The application is AGPLv3; see [LICENSE](../LICENSE). Keep third-party notices with bundled assets: [font OFL](../public/fonts/OFL.txt) and [Pixelarticons MIT license](../public/icons/LICENSE.txt). New assets and dependencies must have compatible terms and retain their required attribution.
