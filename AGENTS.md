# Working on Wilderness Almanac

Read `README.md`, `docs/DEVELOPMENT.md` and `docs/PROJECT_STATE.md` before making changes. The README is for people using the app; keep implementation notes in `docs/`.

## Architecture and compatibility

- Use `src/generation/world.js` for the deterministic pipeline, `src/map-data.js` for topology, and the focused modules in `src/generation/` for placement and numeric surfaces. `src/generation.js` is the public API.
- Keep world/dressing data and numeric geometry independent of Three.js and the DOM. Use `src/generation/campaign-world.js` for campaign edits, `src/rendering/` for meshes and motion, `src/ui/` for tools/persistence, and `src/main.js` for application coordination.
- Preserve seed replay and current visuals when refactoring. Deliberately version world-generation changes; retain campaign import validation, existing save migrations and dressing locks.
- Keep the checked-in rule snapshot in `src/data/world-rules.json`; there is no runtime spreadsheet dependency.
- Avoid unrelated features or renderer/framework/dependency migrations during fixes. Three.js is intentionally pinned to the existing version.

## Visual direction

- Keep orthographic/isometric hexes, low-poly props, three-seed OKLCH palettes, saturated accents and deep contrast. Protect near-black tile sides, trunks and recesses while keeping map surfaces and UI readable.
- Preserve the light bottom-right token clearance; do not create a large empty centre. Grass and rocks can occupy that area unless a POI reserves it.
- Forests use cluster-wide placement with dense touching crowns, occasional sparse tiles and natural neighbouring connections. Avoid straight tree rows along hex connections. Mountains form broad connected ranges emerging from the base.
- Keep river-bank continuity, terrain-height cliffs, occasional shaped islands, and the explicit 50% bridge / 30% ferry / 20% neither roll. Ferries have two docks and a boat; bridges use wood near villages and stone near towns/cities.
- Keep shared UI sizing, fonts, icon style and responsive panel behaviour consistent. Mobile tools follow the viewport-height map without reducing map visibility.

## Verification and maintenance

- For generation changes, run `npm test`. For runnable source changes, run `npm run build`. Run `npm run format:check` and check the diff for whitespace errors.
- For visual changes, inspect in a real browser when available and state verification limitations. Check desktop and mobile layouts when touching shared styles.
- Update the relevant maintainer docs when behaviour or architecture changes. Avoid chronological task logs and stale test counts in the README.
- Keep the AGPLv3 application license and bundled third-party font/icon licenses and attribution intact.
