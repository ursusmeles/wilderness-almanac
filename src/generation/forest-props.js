import { DIRECTIONS, neighbours } from './hex.js';
import { randomFor } from './seed.js';
import { fitsHex, fitsTree, minimumSpacing } from './legacy.js';
import { poiAnchor } from './points-of-interest.js';
import { isForest, forestProfiles } from './forest-types.js';

export const TOKEN_ANCHOR = { x: 0.5, z: 0.16, r: 0.1 };
export { isForest } from './forest-types.js';

// A shared canopy is sampled before trees are assigned to rendering hexes. Hex
// edges only clip the outer forest/cliff boundary; they never plant linking rows.
export function populateForests(states, seed, variant) {
  const byKey = new Map(states.map((cell) => [cell.key, cell]));
  const profiles = forestProfiles(states, seed);
  for (const cell of states) cell.forest = profiles.get(cell.key);
  const forests = states.filter(isForest).sort((a, b) => a.q - b.q || a.r - b.r);
  const available = new Set(forests.map((cell) => cell.key));
  for (const start of forests) {
    if (!available.delete(start.key)) continue;
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      const cell = group[i];
      for (let side = 0; side < 6; side++) {
        const [q, r] = DIRECTIONS[side];
        const next = byKey.get(`${cell.q + q},${cell.r + r}`);
        if (!next || !isForest(next) || next.elevation !== cell.elevation) continue;
        // Permission for crowns to meet across this edge, rather than a path.
        cell.links[side] = true;
        if (available.delete(next.key)) group.push(next);
      }
    }
    plantCanopy(group, byKey, seed, variant);
  }
}

function plantCanopy(group, byKey, seed, variant) {
  const random = randomFor(seed, `forest-canopy:${variant}:${group[0].key}`);
  const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  function point() {
    const cell = group[integer(0, group.length - 1)];
    let x, z;
    do {
      x = (random() - 0.5) * 1.6;
      z = (random() - 0.5) * 1.8;
    } while (!fitsHex(x, z, 0));
    return { cell, x: cell.wx + x, z: cell.wz + z };
  }

  // Overlapping, randomly rotated lobes form broad patches and irregular glades.
  // Spread their centres throughout the whole component, with no hex-centre bias.
  const lobes = [];
  for (let i = 0; i < Math.ceil(group.length * 1.1); i++) {
    let best,
      clearance = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = point();
      const gap = lobes.reduce(
        (nearest, lobe) =>
          Math.min(nearest, Math.hypot(candidate.x - lobe.x, candidate.z - lobe.z)),
        Infinity,
      );
      if (gap > clearance) {
        best = candidate;
        clearance = gap;
      }
    }
    const angle = random() * Math.PI * 2;
    lobes.push({
      x: best.x,
      z: best.z,
      rx: 0.65 + random() * 0.4,
      rz: 0.45 + random() * 0.3,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
    });
  }
  const nearbyLobes = new Map(
    group.map((cell) => [
      cell.key,
      lobes.filter((lobe) => Math.hypot(lobe.x - cell.wx, lobe.z - cell.wz) < 2.1),
    ]),
  );
  const reservations = new Map(group.map((cell) => [cell.key, [cell, ...neighbours(cell, byKey)]]));
  const appearances = new Map(
    group.map((cell) => [cell.key, randomFor(seed, `forest-tree-style:${variant}:${cell.key}`)]),
  );
  // One spatial index enforces trunk spacing across hex boundaries as well.
  const buckets = new Map();
  const bucketSize = 0.25;
  for (const cell of byKey.values()) {
    if (!cell.fixed) continue;
    for (const prop of cell.props.filter((prop) => prop.kind === 'tree')) {
      const wx = cell.wx + prop.x,
        wz = cell.wz + prop.z;
      const key = `${Math.floor(wx / bucketSize)},${Math.floor(wz / bucketSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ ...prop, wx, wz });
    }
  }
  const budget = group.reduce(
    (total, cell) =>
      total + (cell.fixed ? 0 : cell.sparse ? 4 : cell.terrain === 'dense forest' ? 18 : 9),
    0,
  );
  let planted = 0;
  for (let attempt = 0; attempt < group.length * 650 && planted < budget; attempt++) {
    const { cell, x: wx, z: wz } = point();
    if (cell.fixed) continue;
    const density = cell.sparse ? 0.12 : cell.terrain === 'dense forest' ? 1 : 0.38;
    if (random() > density) continue;
    const canopy = nearbyLobes.get(cell.key).some((lobe) => {
      const dx = wx - lobe.x,
        dz = wz - lobe.z;
      const u = (dx * lobe.cos + dz * lobe.sin) / lobe.rx;
      const v = (dz * lobe.cos - dx * lobe.sin) / lobe.rz;
      return u * u + v * v < 1;
    });
    if (!canopy && random() > 0.012) continue;
    const appearance = appearances.get(cell.key);
    const count = cell.props.length;
    const incoming = cell.forest.mixed && (count === 1 || (count > 1 && appearance() < 0.3));
    const deciduous = (cell.forest.family === 'deciduous') !== incoming;
    const species = deciduous ? 1 : appearance() < 0.2 ? 2 : 0;
    const scale = deciduous ? 0.55 + appearance() * 0.25 : 0.57 + appearance() * 0.2;
    const prop = { kind: 'tree', x: wx - cell.wx, z: wz - cell.wz, footprint: 0.24 * scale };
    if (!fitsTree(cell, prop.x, prop.z, prop.footprint)) continue;
    if (
      reservations.get(cell.key).some((next) => {
        if (
          Math.hypot(wx - next.wx - TOKEN_ANCHOR.x, wz - next.wz - TOKEN_ANCHOR.z) <
          TOKEN_ANCHOR.r + prop.footprint * 0.48
        )
          return true;
        return next.pointsOfInterest.some((poi) => {
          const anchor = poiAnchor(poi);
          return (
            Math.hypot(wx - next.wx - anchor.x, wz - next.wz - anchor.z) <
            prop.footprint + anchor.r + 0.14
          );
        });
      })
    )
      continue;
    const bx = Math.floor(wx / bucketSize),
      bz = Math.floor(wz / bucketSize);
    let crowded = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const other of buckets.get(`${bx + dx},${bz + dz}`) ?? []) {
          if (Math.hypot(wx - other.wx, wz - other.wz) < minimumSpacing(prop, other))
            crowded = true;
        }
      }
    }
    if (crowded) continue;
    Object.assign(prop, {
      y: 0,
      scale,
      variant: species,
      angle: random() * Math.PI * 2,
      detailSeed: integer(1, 1000000),
      temperature: ((species === 1 ? 1 : -1) * integer(0, 3)) / 3,
      zone: canopy ? 'canopy' : 'outlier',
      ...(deciduous ? { foliageTone: Math.floor(appearance() * 3) - 1 } : {}),
    });
    cell.props.push(prop);
    const bucketKey = `${bx},${bz}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push({ ...prop, wx, wz });
    planted++;
  }
}
