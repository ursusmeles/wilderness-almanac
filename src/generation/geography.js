import { components, neighbours } from './hex.js';
import { randomFor, smoothNoise, weightedChoice } from './seed.js';

// P(first coast) = .60. Subsequent rolls decrease geometrically.
// .60 × product(.7553 × .94^i, i=0..4) is approximately .08.
export function chooseCoastEdges(seed) {
  const random = randomFor(seed, 'coast-edges');
  if (random() >= 0.6) return [];
  const selected = [Math.floor(random() * 6)];
  for (let index = 0; index < 5; index++) {
    if (random() >= 0.7553 * 0.94 ** index) break;
    const remaining = [0, 1, 2, 3, 4, 5].filter((edge) => !selected.includes(edge));
    const weights = remaining.map(
      (edge) =>
        1 +
        5 * Number(selected.includes((edge + 1) % 6)) +
        5 * Number(selected.includes((edge + 5) % 6)),
    );
    selected.push(weightedChoice(random, remaining, weights));
  }
  return selected.sort();
}

// A narrow peninsula is a tip followed by a chain of land cells with only two
// land neighbours, ending where it reaches the broader mainland.
export function narrowPeninsulaChains(cells, byKey) {
  const land = (cell) => !cell.water && !cell.islandId;
  const adjacent = (cell) => neighbours(cell, byKey).filter(land);
  const chains = [];
  for (const tip of cells.filter((cell) => land(cell) && adjacent(cell).length === 1)) {
    const chain = [tip];
    let previous = tip;
    let current = adjacent(tip)[0];
    while (current && adjacent(current).length === 2) {
      chain.push(current);
      const next = adjacent(current).find((cell) => cell !== previous);
      previous = current;
      current = next;
    }
    chains.push(chain);
  }
  return chains;
}

export function generateGeography(world, options) {
  const water = world.preferences?.water ?? 0;
  if (water && !options) {
    const baseline = structuredClone(world);
    baseline.preferences.water = 0;
    generateGeography(baseline);
    const random = randomFor(world.seed, 'water-preferences');
    const normal = baseline.geography.coastEdges;
    const ocean = baseline.cells.filter((cell) => cell.water === 'ocean').length;
    const targetFraction =
      water === -2
        ? 0.095
        : water === 2
          ? 0.72 + randomFor(world.seed, 'water-target')() * 0.14
          : Math.max(0, Math.min(0.85, ocean / world.cells.length + water * 0.1));
    const count =
      water === -2
        ? 1
        : water === 2
          ? Math.min(6, normal.length + 2)
          : water === -1
            ? Math.max(0, normal.length - 1)
            : Math.max(1, normal.length);
    const edges = normal.slice(0, count);
    while (edges.length < count) {
      const candidates = [0, 1, 2, 3, 4, 5].filter((edge) => !edges.includes(edge));
      edges.push(
        weightedChoice(
          random,
          candidates,
          candidates.map(
            (edge) =>
              1 +
              5 * Number(edges.includes((edge + 1) % 6)) +
              5 * Number(edges.includes((edge + 5) % 6)),
          ),
        ),
      );
    }
    return generateGeography(world, { coastEdges: edges.sort(), targetFraction });
  }
  const { cells, seed } = world;
  const random = randomFor(seed, 'geography');
  const noise = smoothNoise(`${seed}:coast`, 3.2);
  const detail = smoothNoise(`${seed}:bays`, 1.4);
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const coastEdges = options?.coastEdges ?? chooseCoastEdges(seed);
  const desiredCoastalWaterFraction = 0.2 + 0.6 * random();
  world.geography = { coastEdges, desiredCoastalWaterFraction, islands: [], archipelagos: [] };
  if (!coastEdges.length) return;

  const projection = (cell, side) =>
    (cell.wx * Math.cos((side * Math.PI) / 3) + cell.wz * Math.sin((side * Math.PI) / 3)) /
    Math.sqrt(3);
  const limits = coastEdges.map((side) => Math.max(...cells.map((cell) => projection(cell, side))));
  const forced = cells.filter((cell) => cell.edgeSides.some((side) => coastEdges.includes(side)));
  // Unchosen sides remain land, except corners shared with a selected coastline.
  const protectedLand = new Set(
    cells.filter((cell) => cell.edgeSides.length && !forced.includes(cell)).map((cell) => cell.key),
  );
  const fieldScore = (cell) =>
    Math.min(...coastEdges.map((side, index) => limits[index] - projection(cell, side))) +
    (noise(cell.q, cell.r) - 0.5) * 5 +
    (detail(cell.q, cell.r) - 0.5) * (water === 2 ? 4 : 1.8);
  const scores = new Map(cells.map((cell) => [cell.key, fieldScore(cell)]));
  const regionSizes = new Map(world.regions.map((region) => [region.id, region.hexIds.length]));
  const frontier = new Set();
  const wetByRegion = new Map(world.regions.map((region) => [region.id, 0]));
  const flood = (cell) => {
    cell.water = 'ocean';
    wetByRegion.set(cell.regionId, wetByRegion.get(cell.regionId) + 1);
    frontier.delete(cell);
    neighbours(cell, byKey).forEach((next) => {
      if (!next.water && !protectedLand.has(next.key)) frontier.add(next);
    });
  };
  forced.forEach(flood);
  let wet = forced.length;
  const coastalRegionIds = new Set(forced.map((cell) => cell.regionId));
  // The 20–80% target is relative to coastal regions. A single coastal side
  // should not flood most of the world. Bays may still cross region boundaries.
  const target = options
    ? Math.min(
        cells.length,
        Math.round(cells.length * options.targetFraction) +
          (water === 2 ? 20 : water === -2 ? 2 : 5),
      )
    : Math.max(
        wet,
        Math.round(
          [...coastalRegionIds].reduce((sum, id) => sum + regionSizes.get(id), 0) *
            desiredCoastalWaterFraction,
        ),
      );
  // Grow a connected water body through a continuous field, never independent rolls.
  while (wet < target && frontier.size) {
    const next = [...frontier]
      .sort((a, b) => scores.get(a.key) - scores.get(b.key) || (a.key < b.key ? -1 : 1))
      .find(
        (candidate) =>
          wetByRegion.get(candidate.regionId) <
            Math.floor(regionSizes.get(candidate.regionId) * (options ? 1 : 0.8)) &&
          components(
            cells.filter((cell) => !cell.water && cell !== candidate),
            byKey,
          ).length === 1,
      );
    if (!next) break;
    flood(next);
    wet++;
  }

  const forcedKeys = new Set(forced.map((cell) => cell.key));
  for (let pass = 0; pass < cells.length * 2; pass++) {
    const chain = narrowPeninsulaChains(cells, byKey).find((group) => group.length > 2);
    if (!chain) break;
    if (!protectedLand.has(chain[0].key)) {
      chain[0].water = 'ocean';
      continue;
    }
    // An unchosen outer side stays land. Widen its thin arm instead of severing it.
    const candidates = [...new Set(chain.flatMap((cell) => neighbours(cell, byKey)))].filter(
      (cell) => cell.water === 'ocean' && !forcedKeys.has(cell.key),
    );
    candidates.sort(
      (a, b) =>
        neighbours(b, byKey).filter((cell) => !cell.water).length -
        neighbours(a, byKey).filter((cell) => !cell.water).length,
    );
    const widening = candidates.find((candidate) =>
      components(
        cells.filter((cell) => cell.water === 'ocean' && cell !== candidate),
        byKey,
      ).every((group) => group.some((cell) => forcedKeys.has(cell.key))),
    );
    if (!widening) break;
    widening.water = null;
  }
  world.geography.maxNarrowPeninsulaLength = 2;

  // Reserve an island land budget so extra archipelagos do not undo the
  // high-water target. The flood's extra twenty cells pay for these islands.
  let islandBudget =
    water === 2 && options
      ? Math.max(
          0,
          cells.filter((cell) => cell.water === 'ocean').length -
            Math.round(cells.length * options.targetFraction),
        )
      : Infinity;
  const islandSize = () => weightedChoice(random, [1, 2, 3, 4, 5], [58, 23, 11, 5, 3]);
  const eligible = (cell, group) =>
    islandBudget > 0 &&
    cell.water === 'ocean' &&
    !cell.edgeSides.length &&
    neighbours(cell, byKey).every((next) => next.water === 'ocean' || group.includes(next));
  function placeIsland(anchor) {
    const group = [anchor];
    const size = Math.min(islandSize(), islandBudget);
    while (group.length < size) {
      const candidates = [...new Set(group.flatMap((cell) => neighbours(cell, byKey)))].filter(
        (cell) => !group.includes(cell) && eligible(cell, group),
      );
      if (!candidates.length) break;
      group.push(candidates[Math.floor(random() * candidates.length)]);
    }
    islandBudget -= group.length;
    const id = `island-${world.geography.islands.length + 1}`;
    group.forEach((cell) => {
      cell.water = null;
      cell.islandId = id;
    });
    world.geography.islands.push({ id, hexKeys: group.map((cell) => cell.key) });
    return id;
  }
  const attempts =
    water === 2 ? 4 + Math.floor(random() * 4) : random() < 0.72 ? 1 + Math.floor(random() * 3) : 0;
  for (let index = 0; index < attempts; index++) {
    const candidates = cells.filter((cell) => eligible(cell, []));
    if (!candidates.length) break;
    const anchor = candidates[Math.floor(random() * candidates.length)];
    const islandIds = [placeIsland(anchor)];
    if (random() < (water === 2 ? 0.7 : 0.38)) {
      for (let extra = 0; extra < 2 + Math.floor(random() * 2); extra++) {
        const nearby = cells.filter(
          (cell) => eligible(cell, []) && Math.hypot(cell.wx - anchor.wx, cell.wz - anchor.wz) < 6,
        );
        if (!nearby.length) break;
        islandIds.push(placeIsland(nearby[Math.floor(random() * nearby.length)]));
      }
    }
    if (islandIds.length > 1) world.geography.archipelagos.push({ islandIds });
  }
  if (options) world.geography.targetOpenWaterFraction = options.targetFraction;
  world.geography.waterFraction =
    cells.filter((cell) => cell.water === 'ocean').length / cells.length;
}
