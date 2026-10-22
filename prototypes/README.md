# Party token design study

Run `npm run dev` and open `/prototypes/party-token.html`. This standalone page uses the existing world generator, numeric surfaces, palette materials and map meshes. It does not alter the campaign application, generator rules or saved campaigns. Select Cairn, Warden or Waystone to compare real Three.js meshes on the same seed and palette. The enlarged view shows the same piece.

The cairn takes its bevelled obelisk silhouette from the [Lewis pawns in the British Museum](https://www.britishmuseum.org/collection/object/H_1831-1101-130); the warden and waystone are freer interpretations. All geometry is created locally, with no imported model or new dependency.

The prototype supports pointer dragging, a short drop on release, opposing movement lean, six focusable direction buttons and Q/W/A/D/Z/X shortcuts. Escape deselects the token. Reduced motion removes lean and the drop. Click-to-place works while selected. Only completed placements mark hexes visited; the starting hex is also visited. The nearest settlement to axial origin is the start; worlds without settlements fall back to the nearest dry hex, then any hex. Hexes at the map edge disable unavailable directions. Water is traversable in this study.

The token sits at the screen-left corner, uses the local terrain surface height and renders after clearing depth so props cannot obscure it. Accent colour is selected from red, cyan and lime by maximising the minimum OKLab distance from the palette's ground, foliage, roof and water colours. This is a colour-separation heuristic, not a guaranteed accessibility contrast ratio. Camera direction is fixed; the camera follows completed placements.

This is an interaction and appearance study for choosing a direction. Campaign persistence, export/import, Undo, visited-state integration with the Hex Inspector, the actual Sandbox Tools panel and real-device touch/Safari checks are not implemented here. Route state resets on reload. The production renderer and existing campaign data are unchanged.

Focused checks: `node --test tests/party-token-prototype.test.js`.
