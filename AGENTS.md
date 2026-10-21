# Working on Wilderness Almanac

Read `README.md`, `docs/DEVELOPMENT.md` and `docs/PROJECT_STATE.md` before making changes. The README is for people using the app; keep implementation notes in `docs/`.

## Architecture and compatibility

- Use `src/generation/world.js` for the deterministic pipeline, `src/map-data.js` for topology, and the focused modules in `src/generation/` for placement and numeric surfaces. `src/generation.js` is the public API.
- Keep world/dressing data and numeric geometry independent of Three.js and the DOM. Use `src/generation/campaign-world.js` for campaign edits, `src/rendering/` for meshes and motion, `src/ui/` for tools/persistence, and `src/application/campaign-session.js` for campaign state/actions/history. Keep `src/main.js` focused on UI coordination.
- Preserve seed replay and current visuals when refactoring. Deliberately version world-generation changes; retain campaign import validation, existing save migrations and dressing locks.
- Keep mesh builders independent of WebGL/DOM lifecycle. `map-renderer.js` coordinates scene setup; materials, map geometry/batching, controls and ambient scheduling own and dispose their resources. Preserve renderer fixtures on pure refactors.
- Keep renderer/Three.js imports behind the lazy `src/ui/map-view.js` entry. Menu icons use the optional thumbnail cache and palette fallback.
- Keep the checked-in rule snapshot in `src/data/world-rules.json`; there is no runtime spreadsheet dependency.
- Avoid unrelated features or renderer/framework/dependency migrations during fixes. Three.js is intentionally pinned to the existing version.

## Visual direction

- Keep orthographic/isometric hexes, low-poly props, three-seed OKLCH palettes, saturated accents and deep contrast. Protect near-black tile sides, trunks and recesses while keeping map surfaces and UI readable.
- Preserve the light bottom-right token clearance; do not create a large empty centre. Grass and rocks can occupy that area unless a POI reserves it.
- Forests use cluster-wide placement with dense touching crowns, occasional sparse tiles and natural neighbouring connections. Avoid straight tree rows along hex connections. Mountains form broad connected ranges emerging from the base.
- Keep river-bank continuity, terrain-height cliffs, occasional shaped islands, and the explicit 50% bridge / 30% ferry / 20% neither roll. Ferries have two docks and a boat; bridges use wood near villages and stone near towns/cities.
- Keep shared UI sizing, fonts, icon style and responsive panel behaviour consistent. Mobile tools follow the viewport-height map without reducing map visibility.

## Verification and maintenance

- Prefer lightweight, focused verification: review the diff and use targeted checks or browser inspection where useful. State what was checked and any verification limitations.
- Do not automatically run full test suites, browser suites, repeated builds or `npm run check` on every change. Reserve expensive checks for explicit requests or substantial risk, and run them once after changes settle.
- After pushing, do not wait for or poll GitHub Actions. Link CI as pending; investigate only when explicitly asked or when a relevant failure is already known.
- Update the relevant maintainer docs when behaviour or architecture changes. Avoid chronological task logs and stale test counts in the README.
- Keep the AGPLv3 application license and bundled third-party font/icon licenses and attribution intact.
