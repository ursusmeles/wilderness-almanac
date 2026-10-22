import { components, directionTo, distance, neighbours } from './hex.js';
import { randomFor, smoothNoise, weightedChoice } from './seed.js';

// Distances follow the land graph, so slopes never jump across bays or rivers.
function distances(starts, byKey, canVisit = () => true) {
  const result = new Map(starts.map((cell) => [cell.key, 0]));
  const queue = starts.slice();
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbours(queue[i], byKey)) {
      if (result.has(next.key) || !canVisit(next)) continue;
      result.set(next.key, result.get(queue[i].key) + 1);
      queue.push(next);
    }
  }
  return result;
}

export function generateElevation(world) {
  const random = randomFor(world.seed, 'elevation');
  const step = world.preferences?.elevation ?? 0;
  const preferenceRandom = randomFor(world.seed, 'elevation-preferences');
  const noise = smoothNoise(`${world.seed}:uplands`, step === 2 ? 2.3 : 4);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const land = world.cells.filter((cell) => !cell.water);
  const waterDistance = distances(
    world.cells.filter((cell) => cell.water),
    byKey,
  );
  const ranges = [],
    features = [],
    reserved = new Set();
  for (const cell of world.cells) {
    cell.elevation = 0;
    cell.mountainRangeId = null;
    cell.elevationFeatureId = null;
  }
  const clearance = (cell) => waterDistance.get(cell.key) ?? world.radius;
  const pick = (cells, weight) => weightedChoice(random, cells, cells.map(weight));
  const edgeOf = (group) => {
    const keys = new Set(group.map((cell) => cell.key));
    return [...new Set(group.flatMap((cell) => neighbours(cell, byKey)))].filter(
      (cell) => !keys.has(cell.key),
    );
  };
  const reserve = (group) => {
    for (const cell of [...group, ...edgeOf(group)]) reserved.add(cell.key);
  };

  // Level four is placed FIRST, as elongated connected ranges. Only this pass
  // may assign level four; local hills and cliff accents stop at level three.
  const normalRanges = land.length > 260 ? 2 : 1;
  const desiredRanges =
    step < 0
      ? preferenceRandom() < (step === -2 ? 0.12 : 0.55)
        ? normalRanges
        : 0
      : normalRanges + (step === 2 ? 2 : step === 1 && preferenceRandom() < 0.75 ? 1 : 0);
  for (let index = 0; index < desiredRanges; index++) {
    const cliffRange = index > 0 && random() < 0.35;
    let eligible = land.filter(
      (cell) =>
        !cell.islandId &&
        !cell.edgeSides.length &&
        clearance(cell) >= (cliffRange ? 1 : 3) &&
        ranges.every((range) => range.hexKeys.every((key) => distance(cell, byKey.get(key)) > 2)),
    );
    // Small coastal landmasses may have no deep interior, but can still have a
    // modest ridge. Never force a range onto a one-hex island or thin peninsula.
    if (!eligible.length && !index)
      eligible = land.filter(
        (cell) => !cell.islandId && !cell.edgeSides.length && clearance(cell) >= 2,
      );
    const groups = components(eligible, byKey).filter((group) => group.length >= 4);
    if (!groups.length) continue;
    eligible = groups.flat();
    const start = pick(eligible, (cell) => {
      const inland = cliffRange ? 1 / clearance(cell) ** 3 : clearance(cell) ** 2;
      return inland * (0.3 + noise(cell.q, cell.r));
    });
    const allowed = new Set(eligible.map((cell) => cell.key));
    const group = [start];
    const angle = random() * Math.PI;
    const target = step === 2 ? 10 + Math.floor(random() * 13) : 6 + Math.floor(random() * 7);
    while (group.length < target) {
      const frontier = edgeOf(group).filter((cell) => allowed.has(cell.key));
      if (!frontier.length) break;
      group.push(
        pick(frontier, (cell) => {
          const dx = cell.wx - start.wx,
            dz = cell.wz - start.wz;
          const along = dx * Math.cos(angle) + dz * Math.sin(angle);
          const across = -dx * Math.sin(angle) + dz * Math.cos(angle);
          const joins = neighbours(cell, byKey).filter((next) => group.includes(next)).length;
          return (
            Math.exp(-(across ** 2) / 3) *
            (1 + Math.min(4, Math.abs(along))) *
            (joins > 1 ? 1.6 : 1) *
            (0.5 + noise(cell.q, cell.r))
          );
        }),
      );
    }
    const id = `range-${ranges.length + 1}`;
    for (const cell of group) {
      cell.elevation = 4;
      cell.mountainRangeId = id;
      reserved.add(cell.key);
    }
    ranges.push({ id, hexKeys: group.map((cell) => cell.key) });
  }

  // First make a water-constrained, coherent lowland field. Relaxation only
  // lowers it, ensuring ordinary slopes rise by at most one level per hex.
  for (const cell of land) {
    if (cell.mountainRangeId) continue;
    cell.elevation = Math.max(
      0,
      Math.min(
        3,
        Math.round(
          (clearance(cell) - 1) / [3.8, 2.6, 2.1, 1.7, 1.4][step + 2] +
            (noise(cell.q, cell.r) - 0.5) * [0.55, 0.8, 1.15, 1.7, 2.5][step + 2],
        ),
      ),
    );
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of land) {
      if (cell.mountainRangeId) continue;
      const limit = Math.min(...neighbours(cell, byKey).map((next) => next.elevation + 1));
      if (cell.elevation > limit) {
        cell.elevation = limit;
        changed = true;
      }
    }
  }
  // Fold three rings of foothills around the pre-existing ranges. Water is a
  // barrier; near-water ranges intentionally expose occasional dramatic cliffs.
  const rangeDistance = distances(
    land.filter((cell) => cell.mountainRangeId),
    byKey,
    (cell) => !cell.water,
  );
  for (const cell of land)
    cell.elevation = Math.max(cell.elevation, 4 - (rangeDistance.get(cell.key) ?? 4));

  // Islands have their own local relief, including tiny steep-sided islets.
  // This independent stream keeps their accents from shifting mainland relief.
  const islandRandom = randomFor(world.seed, 'island-elevation');
  for (const group of components(
    land.filter((cell) => cell.islandId),
    byKey,
  )) {
    const summit = weightedChoice(
      islandRandom,
      group,
      group.map(() => 1),
    );
    const height = Math.min(
      step === -2 ? 1 : step === -1 ? 2 : 3,
      weightedChoice(islandRandom, [0, 1, 2, 3], [4, 4, 2, 1]),
    );
    const islandKeys = new Set(group.map((cell) => cell.key));
    const localDistance = distances([summit], byKey, (cell) => islandKeys.has(cell.key));
    for (const cell of group) cell.elevation = Math.max(0, height - localDistance.get(cell.key));
    reserve(group);
  }

  const addFeature = (kind, group, extra = {}) => {
    const id = `${kind}-${features.length + 1}`;
    for (const cell of group) cell.elevationFeatureId = id;
    features.push({ id, kind, hexKeys: group.map((cell) => cell.key), ...extra });
    reserve(group);
  };

  // A canyon is a dry, chordless path. Its entire rim is lifted, so it reads as
  // a cut through upland rather than a string of unrelated low hexes.
  const canyonAttempts =
    random() < [0, 0.25, 0.65, 0.85, 1][step + 2] ? (step === 2 ? 3 : random() < 0.22 ? 2 : 1) : 0;
  for (let attempt = 0; attempt < canyonAttempts; attempt++) {
    const eligible = land.filter(
      (cell) =>
        !reserved.has(cell.key) &&
        !cell.edgeSides.length &&
        clearance(cell) >= 2 &&
        cell.elevation >= 1,
    );
    const allowed = new Set(eligible.map((cell) => cell.key));
    for (let retry = 0; retry < 20 && eligible.length; retry++) {
      const group = [pick(eligible, (cell) => cell.elevation + 1)];
      const target = 4 + Math.floor(random() * 4);
      while (group.length < target) {
        const previous = group.at(-1);
        const frontier = neighbours(previous, byKey).filter(
          (cell) =>
            allowed.has(cell.key) &&
            !group.includes(cell) &&
            group.slice(0, -1).every((other) => distance(cell, other) > 1),
        );
        if (!frontier.length) break;
        const lastDirection = group.length > 1 ? directionTo(group.at(-2), previous) : -1;
        group.push(
          pick(frontier, (cell) => (directionTo(previous, cell) === lastDirection ? 0.6 : 2)),
        );
      }
      const directions = group.slice(1).map((cell, i) => directionTo(group[i], cell));
      const rim = edgeOf(group);
      if (
        group.length < 4 ||
        new Set(directions).size < 2 ||
        rim.some((cell) => cell.water || (reserved.has(cell.key) && !cell.mountainRangeId))
      )
        continue;
      for (const cell of group) cell.elevation = 0;
      for (const cell of rim) cell.elevation = Math.max(2, cell.elevation);
      addFeature('canyon', group, { rimKeys: rim.map((cell) => cell.key) });
      reserve(rim);
      break;
    }
  }

  const cliffAttempts =
    random() < [0, 0.3, 0.8, 0.95, 1][step + 2]
      ? 1 + Math.floor(random() * (step === 2 ? 7 : step === 1 ? 5 : 3))
      : 0;
  for (let attempt = 0; attempt < cliffAttempts; attempt++) {
    const eligible = land.filter((cell) => !reserved.has(cell.key) && clearance(cell) === 1);
    if (!eligible.length) break;
    const group = [pick(eligible, () => 1)];
    const target = 1 + Math.floor(random() * 4);
    while (group.length < target) {
      const frontier = edgeOf(group).filter((cell) => eligible.includes(cell));
      if (!frontier.length) break;
      group.push(pick(frontier, () => 1));
    }
    const height = random() < 0.65 ? 2 : 3;
    for (const cell of group) cell.elevation = Math.max(height, cell.elevation);
    addFeature('cliff', group);
  }

  const hillAttempts =
    random() < [0, 0.3, 0.8, 0.9, 1][step + 2]
      ? 1 + Math.floor(random() * (step === 2 ? 5 : 3))
      : 0;
  for (let attempt = 0; attempt < hillAttempts; attempt++) {
    const eligible = land.filter(
      (cell) => !reserved.has(cell.key) && !cell.edgeSides.length && cell.elevation <= 1,
    );
    const allowed = new Set(eligible.map((cell) => cell.key));
    for (let retry = 0; retry < 20 && eligible.length; retry++) {
      const group = [pick(eligible, () => 1)];
      const target = weightedChoice(random, [1, 2, 3], [5, 3, 2]);
      while (group.length < target) {
        const frontier = edgeOf(group).filter((cell) => allowed.has(cell.key));
        if (!frontier.length) break;
        group.push(pick(frontier, () => 1));
      }
      const rim = edgeOf(group);
      if (rim.some((cell) => cell.elevation > 1 || reserved.has(cell.key))) continue;
      const surrounding = Math.max(...rim.map((cell) => cell.elevation));
      for (const cell of group) cell.elevation = surrounding + 2;
      addFeature('hill', group);
      break;
    }
  }

  // Gentle settings attenuate accents after placement, including island shores.
  // Range cells retain their level-four identity and are always inland.
  if (step < 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const cell of land) {
        if (cell.mountainRangeId) continue;
        const allowance = step === -2 ? 1 : 2;
        const limit = Math.min(
          ...neighbours(cell, byKey).map((next) => next.elevation + allowance),
        );
        if (cell.elevation > limit) {
          cell.elevation = limit;
          changed = true;
        }
      }
    }
  }
  world.elevation = { ranges, features };
  return world;
}
