import { DIRECTIONS, distance, keyOf } from '../generation/hex.js';

export const isOpenWater = (cell) =>
  cell.terrain === 'open water' || cell.water === 'ocean' || cell.water === 'lake';
export const visibleUnvisitedPoi = (poi) =>
  ['watchtower', 'abbey', 'ruins', 'stronghold'].includes(poi.kind);
export function sightRange(cell) {
  const base =
    cell.terrain === 'mountains' || cell.elevation >= 4 ? 3 : cell.elevation >= 3 ? 2 : 1;
  return (
    base +
    Number(cell.pointsOfInterest.some((poi) => ['watchtower', 'stronghold'].includes(poi.kind))) +
    Number(['town', 'city'].includes(cell.pointOfLight?.type))
  );
}

function rounded(q, r) {
  let x = Math.round(q),
    z = Math.round(r),
    y = Math.round(-q - r);
  const dx = Math.abs(x - q),
    dz = Math.abs(z - r),
    dy = Math.abs(y + q + r);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dz > dy) z = -x - y;
  return [x, z];
}

// Clip the segment against the six Voronoi half-planes of a full-size hex.
// Include zero-length corner contacts, so a tall hex cannot leak sight at a seam.
function entry(source, target, cell) {
  const q = source.q - cell.q,
    r = source.r - cell.r;
  const dq = target.q - source.q,
    dr = target.r - source.r;
  let lo = 0,
    hi = 1;
  for (const [a, b] of [
    [2, 1],
    [1, 2],
    [-1, 1],
    [-2, -1],
    [-1, -2],
    [1, -1],
  ]) {
    const start = a * q + b * r,
      delta = a * dq + b * dr;
    if (!delta) {
      if (start > 1 + 1e-9) return null;
      continue;
    }
    const t = (1 - start) / delta;
    if (delta > 0) hi = Math.min(hi, t);
    else lo = Math.max(lo, t);
    if (lo > hi + 1e-9) return null;
  }
  return Math.max(0, lo);
}

export function hexSightLine(source, target, byKey) {
  const candidates = new Set(),
    steps = Math.max(1, distance(source, target) * 2);
  for (let i = 0; i <= steps; i++) {
    const [q, r] = rounded(
      source.q + ((target.q - source.q) * i) / steps,
      source.r + ((target.r - source.r) * i) / steps,
    );
    candidates.add(keyOf(q, r));
    for (const [dq, dr] of DIRECTIONS) candidates.add(keyOf(q + dq, r + dr));
  }
  return [...candidates]
    .flatMap((key) => {
      const cell = byKey.get(key);
      if (!cell || key === source.key) return [];
      const t = entry(source, target, cell);
      return t === null ? [] : [{ cell, t }];
    })
    .sort((a, b) => a.t - b.t || a.cell.key.localeCompare(b.cell.key));
}

function waterSightRange(source, byKey, range) {
  const allowance = Math.max(0, source.elevation - 1);
  if (!allowance || isOpenWater(source)) return range;
  const coast = DIRECTIONS.some(([q, r]) => {
    const next = byKey.get(keyOf(source.q + q, source.r + r));
    return next && isOpenWater(next);
  });
  return coast ? range : range + allowance;
}

function waterSight(source, target, line, range) {
  let sea = false;
  for (let i = 0; i < line.length;) {
    const group = [line[i++]];
    while (i < line.length && Math.abs(line[i].t - group[0].t) < 1e-9) group.push(line[i++]);
    // At a corner, land takes precedence over water rather than peeking through it.
    const land = group.filter(({ cell }) => !isOpenWater(cell));
    if (sea && land.length) return land.every(({ cell }) => cell.key === target.key);
    if (!sea) {
      if (group.some(({ cell }) => distance(source, cell) > range)) return false;
      sea = group.some(({ cell }) => isOpenWater(cell));
      if (sea && land.length) return false;
    }
  }
  return sea;
}

export function canSee(source, target, byKey) {
  const range = sightRange(source),
    line = hexSightLine(source, target, byKey);
  if (line.some(({ cell }) => cell.key !== target.key && cell.elevation >= source.elevation + 2))
    return false;
  if (distance(source, target) <= range || waterSight(source, target, line, range)) return true;
  // Elevated inland viewpoints can reach water past lower land. This fallback
  // never reveals land or extends the existing first-shore rule to new shores.
  if (!isOpenWater(target)) return false;
  const waterRange = waterSightRange(source, byKey, range);
  if (waterRange === range || line.some(({ cell }) => cell.elevation >= source.elevation))
    return false;
  return waterSight(source, target, line, waterRange);
}

export function computeFogOfWar(world, hexEdits) {
  const states = new Map(
    world.cells.map((cell) => [
      cell.key,
      hexEdits?.cells[cell.key]?.visited ? 'visited' : 'undiscovered',
    ]),
  );
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const water = world.cells.filter(isOpenWater);
  const sources = world.cells
    .filter((cell) => states.get(cell.key) === 'visited')
    .map((cell) => {
      const range = sightRange(cell);
      const waterRange = waterSightRange(cell, byKey, range);
      return {
        cell,
        range,
        sea: water.some((other) => distance(cell, other) <= range),
        inlandSea: waterRange > range && water.some((other) => distance(cell, other) <= waterRange),
      };
    });
  for (const target of world.cells) {
    if (states.get(target.key) === 'visited') continue;
    if (
      sources.some(
        ({ cell, range, sea, inlandSea }) =>
          (sea || distance(cell, target) <= range || (inlandSea && isOpenWater(target))) &&
          canSee(cell, target, byKey),
      )
    )
      states.set(target.key, 'unvisited');
  }
  return states;
}
