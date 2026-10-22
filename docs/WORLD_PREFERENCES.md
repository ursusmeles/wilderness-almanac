# World preferences

Campaign creation passes four integer steps (`water`, `elevation`, `forests`, `settlements`, each −2…2) to `generateWorld(seed, { preferences })`. Preferences adjust the seed's existing spatial fields and named random streams. They never search for seeds or rewrite the input seed. A custom campaign name remains a display name, with no effect on generation.

## Name effects and composition

The seed chooses an adjective and noun before geography. Each name contributes codes: `LW` and `DW` for light/dense forest, `PL` for settlements, `F` for farms, `W` for wetlands, and `M` for meadow. In particular, `W` does **not** originally change open water and `M` does **not** mean mountains. Opposing codes cancel; each net positive step multiplies its weight by 2.1, clamped to 0.3…3.2.

The default slider position preserves these effects. Sparse/Dense multiply both forest weights by 1/2.1 or 2.1; Sparse also divides the farm weight by 2.1, matching Ashen. Mostly wild divides settlement/farm weights by 2.1; Settled and Densely settled multiply both by 2.1, matching Kingdom. These additional multipliers apply after the old name clamp, so a matching name still receives an additional step. Probabilities remain bounded; terrain suitability can still prevent placement.

Open water and elevation have independent controls. They do not reinterpret the old name vocabulary or change default seeds.

## Open water

Percentages count ocean and lake hexes over all 469 hexes; river channels do not count. “10% more/less” means **10 percentage points**, approximately 47 hexes, rather than multiplying the current fraction by 1.1/0.9.

| Step | Water target                                                       | Coastal edges                                         |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| −2   | About 10% across the map                                           | One seeded coastal edge; at most one                  |
| −1   | Default ocean coverage minus 10 percentage points, floored at zero | One fewer than default, floored at zero               |
| 0    | Original generator                                                 | Original coast rolls                                  |
| +1   | Default ocean coverage plus 10 percentage points, capped at 85%    | Default edges, with one edge added for an inland seed |
| +2   | Seeded target of 72–86%, within the requested 70–90% envelope      | Default edge count plus two, capped at six            |

The same coastal noise and field-based flood shape each map. Nonzero water settings use a global target and relax the old 80% regional cap, while protecting noncoastal edges and connected mainland. −1 can become fully inland when its last coastal edge is removed; freshwater lakes remain. −2 is an independent low-water preset, so it can add a small coast to an otherwise inland seed.

Much more water increases coastline detail noise from 1.8 to 4, attempts 4–7 island groups instead of the default 0–3, and raises the neighbouring archipelago roll from 38% to 70%. The ocean flood reserves twenty additional cells for island land; islands cannot spend beyond the available budget above the water target. Lake placement and shoreline cleanup can move the final fraction. Connectivity and finite space take priority over an exact percentage.

## Elevation

Water and drainage are generated first and remain unchanged by elevation alone. Level four remains exclusive to connected mountain ranges; other features stop at level three.

| Step | Range attempts                             | Typical target range size | Canyon roll / attempts | Cliff roll / attempts | Hill roll / attempts |
| ---- | ------------------------------------------ | ------------------------- | ---------------------- | --------------------- | -------------------- |
| −2   | 12% chance of normal range count           | 6–12                      | 0                      | 0                     | 0                    |
| −1   | 55% chance of normal range count           | 6–12                      | 25%, 1–2               | 30%, 1–3              | 30%, 1–3             |
| 0    | 1, or 2 when land exceeds 260 hexes        | 6–12                      | 65%, 1–2               | 80%, 1–3              | 80%, 1–3             |
| +1   | Normal count plus one with 75% probability | 6–12                      | 85%, 1–2               | 95%, 1–5              | 90%, 1–3             |
| +2   | Normal count plus two                      | 10–22                     | 100%, 3                | 100%, 1–7             | 100%, 1–5            |

Placement can shorten or omit a range/feature when a footprint cannot fit. At −2…+2 the distance-to-water divisor for ordinary uplift is 3.8/2.6/2.1/1.7/1.4 and noise amplitude is 0.55/0.8/1.15/1.7/2.5. Very rugged uses a finer noise scale (2.3 rather than 4), increasing changes between nearby hexes. Very gentle limits island summits to level one and relaxes ordinary land down to one-step slopes after feature placement. Gentle limits island summits to level two and removes jumps above two levels. Rare mountain/water boundaries can still be steeper.

## Forests

The existing coherent canopy ranking chooses forests, maintaining clusters and stable locations across slider settings. The normal fraction is `0.38 × sqrt(LW × DW) / sqrt(M)`, bounded to 10–64% of eligible nonwater, nonmountain land. Existing species and dense-forest selection remain in place.

| Step | Behaviour                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| −2   | Multiply the named baseline forest fraction by 0.2; cleared land becomes meadow or suitably placed wetlands                              |
| −1   | Apply an additional Ashen-like forest step; lower the coverage floor to 2%                                                               |
| 0    | Original named coverage                                                                                                                  |
| +1   | Apply an additional Thorned-like step; allow the fraction up to 88%, subject to the usual open-ground reserve                            |
| +2   | Start with named coverage, then turn 75% of remaining eligible meadow into coherently ranked forest; disable the 28% open-ground reserve |

Wetlands still require low elevation and proximity to fresh water or a canyon. The settings do not create arbitrary wetland tiles just to fill a quota. Very dense forests are placed before settlements, so fewer suitable sites may remain for towns and cities.

## Settlements and farmland

Default regional attempts remain one city at 42%, two towns at 34% each, and five villages at 32% each, multiplied by the effective `PL` weight and clamped to 5–95%. These are attempts, not guaranteed counts. Separate settlements retain two intervening hex steps; footprints remain connected, at a single elevation, inside a region. Villages always occupy one hex.

Wilderness removes city attempts, allows at most one town attempt per region, and imposes global caps of three towns, five villages and **six total settlements**. Each settlement has an independent 50% roll to allow farmland. A settlement's two-hex neighbourhood can contain at most one farm; overlapping neighbourhoods must satisfy every affected settlement's roll and limit. Farms are optional and can be absent entirely.

Mostly wild/Settled use the name-weight composition above. Densely settled uses the same Kingdom-like weight step as Settled and changes footprint rolls:

- City sizes 1/2/3/4/5/6 have probabilities 10/20/25/20/15/10%, compared with the normal 50/40/10% for sizes 1/2/3.
- Town sizes 1/2 have probabilities 55/45%.
- After normal nearby farmland, a seeded fraction of 20–40% of remaining eligible meadow becomes farmland, ranked by a coherent field. These extra farms may be farther than two hexes from a settlement. Eligible meadow is dry, unoccupied and at elevation 0–2.
- The open-ground reserve is disabled. Water, mountain and settlement suitability constraints remain enforced.

Very wet or very rugged maps can support fewer settlements even at Densely settled. Very dense forest can also limit city footprints. The sliders express priorities within those spatial constraints rather than overriding each other with invalid placements.

## Replay and compatibility

New campaigns use generator version 7 and save normalized preferences alongside the original seed. Exports, imports, local campaigns, edited-world reconstruction, map replacement and thumbnail signatures include these settings. Changing a campaign name or palette does not change preferences or generation.

Version 6 remains supported and rejects nonzero preferences. Its existing generation output is preserved exactly; version-7 defaults produce the same landscape with new replay metadata. Existing unversioned seed links replay version 6. New links carry `generator=7` and `world=water,elevation,forests,settlements`, such as `world=1,0,-1,2`. Unknown versions or malformed preference links do not silently create a default map. Older clients reject version-7 campaigns through the existing version validation.
