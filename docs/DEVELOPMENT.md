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
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the Node test suite. Generation changes require the full suite; runnable source changes require a production build. Use `npx prettier --write <changed-files>` to format touched files. `npm run preview` serves the production build. `npm run check` runs formatting, unit tests, a production build and browser tests in order. The browser tests serve the built app on port 4178; build before running `npm run test:e2e` on its own.

The Playwright suite in `e2e/` runs against Chromium at desktop and phone viewports. It covers campaign replacement/zoom, edit-preserving JSON import/export, dirty-form navigation, Undo, save failure/retry/recovery and mobile panels. Each test uses an isolated browser context and deterministic campaign fixture; simulated storage failures are confined to test initialization. One worker bounds software-WebGL CPU/memory use. Failure screenshots, traces and an HTML report are written under ignored `test-results/` and `playwright-report/`.

`.github/workflows/checks.yml` runs `npm run check` on pushes to `main`, pull requests and manual dispatch with Node 24. Official actions are pinned to commit SHAs, the job uses read-only repository permissions and uploads browser reports for seven days.

Inspect visual changes in a real browser at desktop and phone widths. Check map selection, tool panels, viewport expansion and browser errors when changing workspace layout. Pointer-driven mobile emulation does not establish physical touch/pinch correctness.

## Code map

| Path                                                                                             | Responsibility                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `index.html`, `src/styles.css`                                                                   | Document, fixed menu theme, campaign palette styling and responsive workspace layout  |
| `src/main.js`                                                                                    | UI coordination, lazy map entry, selection and palette controls                       |
| `src/application/campaign-session.js`                                                            | DOM-independent campaign actions/state, bounded undo history and persistence results  |
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
| `src/application/campaigns.js`, `src/ui/campaign-store.js`, `campaign-menu.js`                   | Campaign persistence/import/export, library and tile-icon actions                     |
| `src/ui/hex-inspector.js`, `panels.js`, `tile-preview.js`                                        | Inspector editing, responsive panel state and shared still previews                   |
| `src/ui/map-view.js`, `thumbnail-cache.js`                                                       | Lazy WebGL entry point and optional bounded IndexedDB thumbnail cache                 |
| `src/ui/storage.js`, `map-link.js`, `map-console.js`                                             | Preferences, replay URLs, clipboard and action feedback                               |
| `src/data/world-rules.json`                                                                      | Checked-in rule and naming snapshot with source attribution                           |
| `public/fonts/`, `public/icons/`                                                                 | Self-hosted fonts, selected SVG icons and their licenses                              |
| `e2e/`, `playwright.config.js`                                                                   | Desktop/mobile production-build browser regression tests                              |
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

`campaign-session.js` owns the active record, base/effective world, dressing, selection and a maximum of 20 undo entries. Actions derive/validate the next state before committing it, then call an injected persistence adapter. Results distinguish world, tracking and palette updates and retain separate campaign/preferences save outcomes. A failed save keeps live changes and history; the DOM handles warnings rather than rolling back an applied action. Palette changes survive hex Undo, and opening/replacing a world resets history.

The homepage statically imports no renderer or Three.js code. `src/ui/map-view.js` is dynamically imported on campaign entry and shares the still preview renderer with Inspector. Failed imports leave the menu usable for retry. Keep renderer imports behind this boundary. The browser suite checks requests before/after entry and enforces a 200 KB uncompressed initial-JavaScript budget.

Campaign icons use PNGs captured when a map is opened or left. A best-effort IndexedDB cache retains at most 32 images, keyed by a SHA-256 signature of cache/generator version, seed, variant, palette, icon key and hex edits. It is separate from campaign/localStorage quota and is never part of JSON exports. Missing/stale/blocked cache entries show a three-colour palette tile; icon shuffling keeps its existing selection rules. No background renderer is fetched to fill a missing menu image.

## Campaigns, persistence and links

- `wilderness-almanac:campaigns-v1` stores local campaign records and recoverable deletion state. `hex-sandbox:map-v1` stores the active campaign ID, map preferences and custom palettes through the storage module. Keep older campaign-field and single-map preference migration support.
- Campaign records carry identity, creation time, editable-name state, generator version, seed, dressing variant, three palette seeds/name and icon hex. New Map replaces that record's world while preserving identity, creation time and palette. A name follows the generated map name until explicitly renamed.
- Export envelope version 2 includes version-1 sparse hex edits and bounded frozen dressing descriptors. Version-1 envelopes still import. Validate dates, lengths, coordinates, enums, finite dimensions and prop limits; reject unsupported generator versions and imports over 4 MB. Never accept arbitrary mesh data from imports.
- Downloads use a filename-safe campaign name and local date: `wilderness-almanac-[campaignname]-[YYYY-MM-DD].json`. Import adds a separate local campaign. The palette travels with that campaign; the full custom-palette library does not.
- Map links contain `seed`, `variant` and three colour seeds, with URL values taking precedence over local preferences. They omit hex edits, visited status and locks. Changing the map updates the URL without adding browser-history entries.
- `campaign-store.js` owns campaign-library reads/writes. Retain unreadable campaign records verbatim alongside editable records, preserving unknown envelope and local campaign fields without feeding them into rendering. Unknown/malformed library envelopes and unreadable deletion records are read-only. Do not treat failed reads as an empty/first-run library or overwrite them during preference migration.
- Check the stored library against the loaded snapshot before writing. A detected change from another tab blocks that write; users can download their current in-memory campaigns before reloading. This is a best-effort conflict check, not a transactional cross-tab lock.
- `save-status.js` tracks campaign and preference failures independently of action-console messages. Clear each failure only after that storage target writes successfully. Persistent warnings remain in the menu/map through other actions, and the map offers a direct campaign download.
- Recovery downloads preserve this tab's last read or successfully written library text, including unreadable records. They are separate from ordinary campaign exports and are not accepted by the single-campaign import flow.
- Handle blocked/full browser storage without losing the active in-memory session. Storage capacity and the import-size limit are independent.

Deletion requires confirmation. Undo deletion expires on the next campaign action, including entering, renaming, icon changes, copying/sharing, exporting, creating or importing. Initial tile icons choose a settlement/POI; refresh rolls 50/50 between that pool and other eligible terrain, excluding the current tile, empty meadows and open water, with fallback when a pool is empty.

## Interface conventions

Styles follow CUBE CSS in ordered `reset`, `tokens`, `base`, `compositions`, `utilities`, `blocks` and `exceptions` layers. Use native nesting within blocks, `cluster`/`stack`/`grid-pair` for composition, and shared rem-based spacing, typography and control tokens. Keep state overrides in `exceptions`; reserve `!important` for the native `hidden` contract. Prefer labelled semantic HTML and remove wrappers when the parent can own the layout.

Use Geist Sans for body copy and controls, and Geist Pixel Square for titles, metadata values, seeds and status details. Fonts are local and preloaded. Keep the render-blocking stylesheet and inline dark defaults in `index.html` so the initial paint does not flash white or unstyled content.

The campaign library has a fixed dusk-and-gold theme. Map controls follow their campaign palette. Keep shared 2/3/4px radius tokens, 12px control labels, 40px desktop controls and 44px touch targets; compact icon controls retain their established target sizes. Use only the needed Pixelarticons paths in the local SVG sprite and retain its source/license notes.

The workspace root is `#campaign-workspace`. Desktop places the map left and tools right; panels can reorder, minimise vertically or fold into rails. Mobile keeps the map section at viewport height and places Inspector then Tracker below it, at full width. Expansion fills the browser viewport using CSS, with browser chrome retained. Preserve settings/panel preferences across campaigns and screen sizes.

Wind controls share accessible switch/diode semantics with visited status. Respect reduced-motion preferences, pause animation in hidden documents, and keep transient action announcements separate from silent hover-coordinate updates.

## Licensing

The application is AGPLv3; see [LICENSE](../LICENSE). Keep third-party notices with bundled assets: [font OFL](../public/fonts/OFL.txt) and [Pixelarticons MIT license](../public/icons/LICENSE.txt). New assets and dependencies must have compatible terms and retain their required attribution.
