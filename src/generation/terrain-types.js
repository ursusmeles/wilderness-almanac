import { components, distance, neighbours } from './hex.js';
import { smoothNoise, randomFor } from './seed.js';
import { clamp, distanceField } from './spatial.js';
import { preferenceWeights } from './world-preferences.js';

export const TERRAIN_TYPES = [
  'meadow',
  'farmlands',
  'light forest',
  'dense forest',
  'river',
  'open water',
  'mountains',
  'wetlands',
];
export function generateTerrainTypes(world) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const freshwater = distanceField(
    world.cells,
    byKey,
    (cell) => cell.water === 'river' || cell.water === 'lake',
  );
  const coast = distanceField(world.cells, byKey, (cell) => cell.water === 'ocean');
  const mountain = distanceField(world.cells, byKey, (cell) => cell.elevation >= 3);
  const canopy = smoothNoise(`${world.seed}:canopy`, 3.2);
  const detail = smoothNoise(`${world.seed}:forest-detail`, 1.7);
  const wetness = smoothNoise(`${world.seed}:wetlands`, 2.1);
  const species = smoothNoise(`${world.seed}:tree-species`, 4);
  const weights = preferenceWeights(world);
  const forestStep = world.preferences?.forests ?? 0;
  const land = world.cells.filter((cell) => !cell.water && cell.elevation < 4);
  for (const cell of world.cells) {
    cell.terrain = cell.water
      ? cell.water === 'river'
        ? 'river'
        : 'open water'
      : cell.elevation === 4
        ? 'mountains'
        : 'meadow';
    cell.treeVariant = species(cell.q, cell.r) + cell.elevation * 0.07 > 0.6 ? 0 : 1;
  }
  const forestScore = (cell) =>
    canopy(cell.q, cell.r) +
    detail(cell.q, cell.r) * 0.22 +
    0.22 / (1 + freshwater(cell)) +
    Math.min(5, coast(cell)) * 0.025;
  let forestFraction = clamp(
    (0.38 * Math.sqrt(weights.LW * weights.DW)) / Math.sqrt(weights.M),
    forestStep === -1 ? 0.02 : 0.1,
    forestStep === 1 ? 0.88 : 0.64,
  );
  if (forestStep === -2) forestFraction *= 0.2;
  const forests = land
    .slice()
    .sort((a, b) => forestScore(b) - forestScore(a))
    .slice(0, Math.round(land.length * forestFraction));
  for (const cell of forests) cell.terrain = 'light forest';
  const denseFraction = clamp(0.6 * Math.sqrt(weights.DW / weights.LW), 0.16, 0.86);
  // Convert coherent parts of woodland clusters, favoring upland and range edges.
  for (const group of components(forests, byKey)) {
    const score = (cell) =>
      detail(cell.q, cell.r) * 0.55 + canopy(cell.q, cell.r) * 0.35 + 0.5 / (1 + mountain(cell));
    group.sort((a, b) => score(b) - score(a));
    for (const cell of group.slice(0, Math.round(group.length * denseFraction)))
      cell.terrain = 'dense forest';
  }
  const canyonKeys = new Set(
    world.elevation.features.filter((f) => f.kind === 'canyon').flatMap((f) => f.hexKeys),
  );
  const wetCandidates = land.filter(
    (cell) =>
      cell.terrain === 'meadow' &&
      cell.elevation <= 1 &&
      (freshwater(cell) <= 2 || canyonKeys.has(cell.key)),
  );
  const wetScore = (cell) =>
    wetness(cell.q, cell.r) + 0.5 / (1 + freshwater(cell)) + (canyonKeys.has(cell.key) ? 0.55 : 0);
  wetCandidates.sort((a, b) => wetScore(b) - wetScore(a));
  const wetCount = Math.min(
    wetCandidates.length,
    Math.round(land.length * clamp(0.055 * weights.W, 0.016, 0.18)),
  );
  for (const cell of wetCandidates.slice(0, wetCount)) cell.terrain = 'wetlands';
  // Extreme density converts 75% of eligible remaining meadow using the same
  // coherent canopy field, rather than scattering independent forest rolls.
  if (forestStep === 2) {
    const meadow = land.filter((cell) => cell.terrain === 'meadow');
    meadow.sort((a, b) => forestScore(b) - forestScore(a));
    for (const cell of meadow.slice(0, Math.round(meadow.length * 0.75)))
      cell.terrain = detail(cell.q, cell.r) < denseFraction ? 'dense forest' : 'light forest';
  }
  world.terrain = {
    openLandMinimum: forestStep === 2 || world.preferences?.settlements === 2 ? 0 : 0.28,
    forestTarget: forestFraction,
    wetlandsTarget: wetCount,
  };
  preserveOpenLand(world);
  return world;
}

export function preserveOpenLand(world) {
  const land = world.cells.filter((cell) => !cell.water);
  const open = land.filter(
    (cell) => !cell.pointOfLight && ['meadow', 'farmlands'].includes(cell.terrain),
  );
  const minimum = Math.ceil(land.length * world.terrain.openLandMinimum);
  const candidates = land.filter(
    (cell) =>
      !cell.pointOfLight && ['light forest', 'dense forest', 'wetlands'].includes(cell.terrain),
  );
  // Clear the least wooded edges first, preserving the dense interiors.
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  candidates.sort(
    (a, b) =>
      neighbours(a, byKey).filter((c) => c.terrain.includes('forest')).length -
      neighbours(b, byKey).filter((c) => c.terrain.includes('forest')).length,
  );
  for (const cell of candidates.slice(0, Math.max(0, minimum - open.length)))
    cell.terrain = 'meadow';
}

export function generateFarmlands(world) {
  const random = randomFor(world.seed, 'farmlands');
  const step = world.preferences?.settlements ?? 0;
  const weights = preferenceWeights(world);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const water = distanceField(world.cells, byKey, (cell) => !!cell.water);
  const settlementCells = world.cells.filter((cell) => cell.pointOfLight);
  const farmOwners = new Set();
  const farmRolls = new Map(
    world.settlements.map((settlement) => [
      settlement.id,
      randomFor(world.seed, `wilderness-farm:${settlement.id}`)() < 0.5,
    ]),
  );
  for (const cell of world.cells) {
    if (cell.terrain !== 'meadow' || cell.pointOfLight || cell.elevation > 2) continue;
    const nearest = Math.min(...settlementCells.map((next) => distance(cell, next)));
    if (nearest > 2) continue;
    if (step === -2) {
      const owners = new Set(
        settlementCells
          .filter((next) => distance(cell, next) <= 2)
          .map((next) => next.pointOfLight.id),
      );
      if ([...owners].some((id) => !farmRolls.get(id) || farmOwners.has(id))) continue;
      owners.forEach((id) => farmOwners.add(id));
      cell.terrain = 'farmlands';
      continue;
    }
    const probability = clamp(
      (nearest === 1 ? 0.55 : 0.3) * weights.F * (water(cell) <= 2 ? 1.25 : 0.8),
      0.04,
      0.94,
    );
    if (random() < probability) cell.terrain = 'farmlands';
  }
  if (step === 2) {
    const meadow = world.cells.filter(
      (cell) => cell.terrain === 'meadow' && !cell.pointOfLight && cell.elevation <= 2,
    );
    const noise = smoothNoise(`${world.seed}:settled-farmland`, 2.6);
    meadow.sort((a, b) => noise(b.q, b.r) - noise(a.q, a.r));
    const fraction = 0.2 + randomFor(world.seed, 'settled-farmland-fraction')() * 0.2;
    for (const cell of meadow.slice(0, Math.round(meadow.length * fraction)))
      cell.terrain = 'farmlands';
  }
  preserveOpenLand(world);
  world.terrain.counts = Object.fromEntries(
    TERRAIN_TYPES.map((type) => [type, world.cells.filter((cell) => cell.terrain === type).length]),
  );
  return world;
}
