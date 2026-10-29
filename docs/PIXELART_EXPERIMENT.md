# Pixelart map rework

The `pixelart` branch is the independent map-art rework. Sandbox features can continue on `main`; bring those changes into this branch periodically and merge the art only after visual approval. Trees, grass, stones, wetland dressing, wheat and vineyards use the new presentation. Other props retain their existing presentation until converted deliberately.

## Accepted direction

- Keep solid, lit 3D objects, orthographic/isometric composition, depth occlusion and geometry-based picking. Crowns and branches cast and receive shadows and use the existing wind and time-of-day controls.
- Build natural silhouettes with seeded variations in shape, size, angle and colour. Use coherent foliage clumps and uneven branching, respecting the existing footprint, token/POI reservations and forest placement. Avoid uniform plantation-like crowns.
- Make pixel patterns from connected patches, leaf/needle fans, dark recesses and restrained growth highlights. Colour boundaries belong in textures; geometry supplies silhouette and relief. A separate polygon for every coloured pixel is too expensive on full forests.
- Give each species eight OKLCH swatches with its own hue, lightness and chroma, plus distinct bark. The map's element colour supplies a bounded 22% hue tint and small lightness/chroma adjustments. Props retain their material identity across palettes. Per-prop temperature and foliage-tone variation remain.
- Apply night colouring after the species ramp and fog grayscale after that. Palette independence does not override scene lighting or visibility rules.
- Keep world generation, names, tree counts, dressing descriptors, seed replay, locks and exports intact. Visual species choices happen in the renderer. The optional thumbnail-cache revision invalidates old model previews.

## Evergreen models

`pixel-evergreens.js` retains the accepted fir, spruce and pine models. Each has broad/tall forms and eight detail-seed styles, retaining original transforms and overall height.

Fir uses a broad, tiered cone and emerald colours. Spruce uses a slender spire, hanging needle clusters and blue-green/silver tones. Pine has a crooked, tapering stem with bent limbs supporting overlapping, flattened olive/sage needle clumps at uneven heights. Its open-grown silhouette draws on natural upland Scots pine references from the [Woodland Trust](https://ati.woodlandtrust.org.uk/how-to-record/species-guides/scots-pine/) and [National Trust for Scotland](https://www.nts.org.uk/stories/now-is-the-time-for-pine). Pine upper limbs have warmer bark.

Named fir, spruce and pine woods use their corresponding models. Evergreen minorities in deciduous woods use the profile's neighbouring species. Taiga selects approximately 40% spruce, 40% fir and 20% pine from the existing detail seed. Trees outside named woods use an equal repeatable mix.

## Deciduous models and birch mixing

`pixel-deciduous.js` supplies eight seeded forms each for oak, beech, ash, birch and fruit-bearing orchard trees. Oak has a low, spreading crown with substantial forks and deeper moss greens. Beech has a rounded, full crown, grey bark and fresh greens. Ash uses a lighter, open branching crown with sage tones. Birch has a slender crown, fine branching, brighter leaves and white bark with dark pixel scars, taking its identifying cues from the [Woodland Trust's silver birch guide](https://www.woodlandtrust.org.uk/trees-woods-and-wildlife/british-trees/a-z-of-british-trees/silver-birch/).

For a light-forest hex, a lone deciduous tree in its hex, an outlying deciduous tree, or a tree outside a named forest, two of five detail-seed outcomes choose birch: approximately 40% across these trees. The remaining outcomes retain the named deciduous type where possible, otherwise selecting oak, beech or ash. This includes light woods still labelled ash, oak or another existing name. It is a repeatable proportion, not a per-hex quota, so small groups can differ. Dense birch woods retain their birch identity. Mixed evergreen/deciduous edges respect the neighbouring type before applying the same light/lone-tree rule.

Warm element colours broaden the deciduous ramps into seasonal foliage: golden birch, rusty oak, copper beech and amber ash, with retained green/cool patches and deeper warm shadows. A smooth hue-based response and the existing per-tree foliage tone vary the transition, rather than tinting every leaf the same orange. Neutral/cool palettes retain the normal species-led greens. This seasonal response is specific to deciduous foliage; the accepted evergreen ramps stay unchanged.

Fruit-bearing trees retain a separate rounded orchard form and their original ten fruit positions/colour choices. Fruit uses small cubes instead of subdivided spheres to keep the pixelart detail inexpensive. These trees are excluded from the decorative birch substitution. None of these choices rewrites map names or saved species data.

## Ground dressing, wetlands and farmland

`pixel-ground-props.js` renders sparse grass tufts, stepped stones, shallow puddles and cattails at their existing reserved positions. Stones and vine foliage use coarse solid voxel forms, sharing the exposed-face merger rather than adding individual cubes. Small road stones use textured boxes and keep their terrain-relative colouring. Puddles have low, stepped shorelines and quiet patches of water colour; no extra floating debris, sparkles or decorative scatter is added. The main water, river and mountain surfaces remain unchanged.

Grass uses two crossing, fixed-world blades with nearest-filtered alpha-test cutouts, four seed-selected silhouettes and several connected colour patches. These are lit 3D meshes, not camera-facing sprites. Reed leaves use the same technique around three solid stems and textured brown cattail heads. Ordinary grass and rocks stay static; wetland grass, reed blades, stems and heads retain the shared wind settings. Cutout blades do not cast shadows; solid reed stems/heads use the existing matching wind depth shader.

Wheat retains every sampled plant, the dense staggered coverage, original convex patch outlines, rolling relief and road/POI/token clearances. Two indexed crossing blades per stalk carry stepped grain kernels and coloured pixels in one cutout texture: four triangles per plant, the same count as the former separate stalk/head triangles, with fewer vertices. The textured golden ground closes gaps without extra stalks. Legacy rectangles and old plot-style imports use the same pixel wheat presentation at their original placements.

Vineyards retain three trellis rows per existing crop footprint. Each row has three overlapping textured foliage clumps and restrained solid grape bunches, replacing numerous polyhedral leaves and individual berries. Dark timber, furrowed soil, foliage and purple fruit have separate small colour ramps. Vine foliage follows the deciduous seasonal palette response. Grass can warm toward straw in warm palettes; rocks retain muted cool/mineral accents, and wetland vegetation stays greener. Pixel variation is carried by shared textures rather than extra materials per pixel.

## Rendering and ownership

`pixel-foliage-geometry.js` owns the shared exposed-face merger, padded atlas packing and indexed crown geometry. Numeric templates are cached; WebGL resources remain renderer-owned. Evergreen and deciduous atlases each encode species and swatch indices, with nearest filtering, no mipmaps, one-texel gutters and size-sorted packing. This avoids one material per species and extra triangles along colour boundaries. The evergreen geometry and atlas data remain identical through the shared-helper extraction.

`pixel-foliage-colors.js` defines the species ramps. `pixel-foliage-materials.js` owns palette/temperature/tone/fog variants, bark materials and the small birch-bark texture. Palette/time changes repaint existing resources; disposal releases every owned material and texture. The shared depth material and wind uniforms keep crowns, trunks and shadows moving together.

`map-meshes.js` passes the existing forest profile, terrain and deciduous-tree count into the tree builder. Both foliage families retain UVs and indices through batching. Four-by-four axial groups permit frustum culling and bounded raycasts; a conservative bounding-sphere margin includes wind displacement. Picking ranges count indexed triangles. Other props retain their existing batching behaviour.

`pixel-dressing-geometry.js` supplies the small solid-form atlas, cutout patterns, indexed plant blades and ground UVs. `pixel-dressing-materials.js` owns all dressing texture/material variants by kind, temperature and fog state, and repaints them in place for palette and night changes. All texture data is generated locally; no image downloads or dependencies are introduced. Alpha-test cutouts remain opaque render passes, avoiding transparent-object sorting. Every geometry using the `pixelDressing` material tag must be indexed with UVs so mixed forms merge safely and retain correct picking ranges. Expensive grain uses four-by-four axial chunks; vine foliage uses eight-by-eight chunks. Tiny ground props share map-wide batches to limit draw calls. Renderer rebuilds release geometry, and the material registry releases each owned texture/material once on disposal.

## Performance and review

The first voxel experiment increased full-forest geometry substantially. Keep shared textures, indexed rectangles and local batches as new props are converted. Do not return to world-wide foliage batches or polygons for colour detail. Birch/deciduous crowns use a coarser sampling grid than needles. Fully zoomed-out views gain less from culling; distant level-of-detail models remain an option if device measurements warrant them.

Use representative 469-hex forest maps as well as isolated model previews when reviewing cost. Record triangles, buffer memory, visible draw work and selection latency separately; local CPU measurements and software-WebGL captures do not establish physical-phone FPS.

Review individual variants, dense woods, the 40% birch light-forest mix, orchard fruit, mixed forest edges, multiple palettes, all four lighting modes and fog. Check indexed picking and resource disposal when changing batching/materials. Prefer focused lint/format checks and visual inspection to broad suites for each iteration. The approved renderer fixtures still describe the original low-poly presentation; refresh them only after accepting the rework. Keep this branch off `main` until approval.

For ground dressing also compare sparse meadow/wetland tiles with dense wheat and vineyards, inspect cutout silhouettes close up and at map scale, and check old rectangular crop descriptors. Keep the original grain sample count and clearance boundaries; reduce decorative mesh complexity rather than adding scatter or thinning the field unpredictably.
