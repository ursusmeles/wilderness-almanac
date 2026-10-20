import { DIRECTIONS, keyOf, worldPosition } from './generation/hex.js';

// World topology is independent of rendering and of the map seed.
// Radius 12 gives a complete 469-cell hex. Six compact Voronoi regions are
// clipped to that outline; complete small hexagons cannot tile it in six pieces.
export const WORLD_RADIUS = 12;
export function createTopology() {
  const cells = [];
  const regions = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    origin: { q: 0, r: 0 },
    hexIds: [],
  }));
  const sites = [
    [-6, -3],
    [0, -3],
    [6, -3],
    [-6, 3],
    [0, 3],
    [6, 3],
  ];
  regions.forEach((region, index) => {
    region.origin = { q: sites[index][0], r: sites[index][1] };
  });
  function add(q, r, regionIndex) {
    const region = regions[regionIndex];
    const cell = {
      key: keyOf(q, r),
      q,
      r,
      regionId: region.id,
      x: q - region.origin.q,
      y: r - region.origin.r,
      ...worldPosition({ q, r }),
      water: null,
      islandId: null,
      lakeId: null,
      downstream: null,
      upstream: [],
      flow: 0,
      riverWidth: 0,
      elevation: 0,
      terrain: null,
      pointOfLight: null,
      pointsOfInterest: [],
    };
    cell.id = `#${region.id}:${cell.x},${cell.y}`;
    cells.push(cell);
    region.hexIds.push(cell.id);
  }
  for (let q = -WORLD_RADIUS; q <= WORLD_RADIUS; q++) {
    for (let r = -WORLD_RADIUS; r <= WORLD_RADIUS; r++) {
      if (Math.abs(q + r) > WORLD_RADIUS) continue;
      const scores = sites.map(([x, y]) => (q - x) ** 2 + (q - x) * (r - y) + (r - y) ** 2);
      add(q, r, scores.indexOf(Math.min(...scores)));
    }
  }
  cells.sort((a, b) => a.regionId - b.regionId || a.q - b.q || a.r - b.r);
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  for (const cell of cells) {
    cell.edgeSides = DIRECTIONS.flatMap(([q, r], side) =>
      byKey.has(keyOf(cell.q + q, cell.r + r)) ? [] : [side],
    );
  }
  return { cells, regions, radius: WORLD_RADIUS };
}
