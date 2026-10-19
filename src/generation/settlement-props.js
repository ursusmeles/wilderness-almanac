import { DIRECTIONS } from './hex.js';
import { randomFor } from './seed.js';
import { POI_ANCHOR } from './points-of-interest.js';
import { TOKEN_ANCHOR } from './forest-props.js';

export const isBarrier = (prop) => prop.kind === 'fence' || prop.kind === 'city-wall';

export function barrierEnds(prop) {
  const dx = (Math.cos(prop.angle) * prop.length) / 2;
  const dz = (Math.sin(prop.angle) * prop.length) / 2;
  return [
    [prop.x - dx, prop.z - dz],
    [prop.x + dx, prop.z + dz],
  ];
}

export function barrierDistance(prop, x, z) {
  const [[ax, az], [bx, bz]] = barrierEnds(prop);
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

// Reserve narrow edge strips before buildings, keeping the POI corner and token
// space open. These are capsules rather than large circular prop footprints.
export function settlementBarriers(world, variant) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const result = new Map();
  const cities = new Map();
  const edge = (cell, side, kind, random) => {
    const normal = (side * Math.PI) / 3;
    const radius = kind === 'fence' ? 0.65 : 0.71;
    return {
      kind,
      side,
      x: Math.cos(normal) * radius,
      y: 0,
      z: Math.sin(normal) * radius,
      angle: normal + Math.PI / 2,
      length: kind === 'fence' ? 0.42 + random() * 0.14 : 0.78,
      footprint: kind === 'fence' ? 0.022 : 0.045,
      temperature: 2 / 3,
      detailSeed: Math.floor(random() * 1000000),
    };
  };
  const clear = (cell, prop) =>
    barrierDistance(prop, TOKEN_ANCHOR.x, TOKEN_ANCHOR.z) >=
      TOKEN_ANCHOR.r + prop.footprint + 0.025 &&
    (!cell.pointsOfInterest.length ||
      barrierDistance(prop, POI_ANCHOR.x, POI_ANCHOR.z) >= POI_ANCHOR.r + prop.footprint + 0.025);
  const save = (cell, prop) => {
    if (!result.has(cell.key)) result.set(cell.key, []);
    result.get(cell.key).push(prop);
  };
  for (const cell of world.cells) {
    if (!cell.pointOfLight) continue;
    const { type, id } = cell.pointOfLight;
    if (type === 'city') {
      if (!cities.has(id)) cities.set(id, []);
      cities.get(id).push(cell);
    } else if (type === 'village') {
      const random = randomFor(world.seed, `village-fence:${id}:${variant}`);
      if (random() >= 0.35) continue;
      const start = Math.floor(random() * 6);
      for (let k = 0; k < 6; k++) {
        const prop = edge(cell, (start + k) % 6, 'fence', random);
        if (!clear(cell, prop)) continue;
        save(cell, prop);
        break;
      }
    }
  }
  for (const [id, cells] of cities) {
    const random = randomFor(world.seed, `city-wall:${id}:${variant}`);
    const boundary = [];
    for (const cell of cells.toSorted((a, b) => a.q - b.q || a.r - b.r)) {
      for (let side = 0; side < 6; side++) {
        const [q, r] = DIRECTIONS[side];
        if (byKey.get(`${cell.q + q},${cell.r + r}`)?.pointOfLight?.id === id) continue;
        const angle = (side * Math.PI) / 3;
        const vertex = (sign) =>
          [
            cell.wx + (Math.cos(angle) * Math.sqrt(3)) / 2 - Math.sin(angle) * 0.5 * sign,
            cell.wz + (Math.sin(angle) * Math.sqrt(3)) / 2 + Math.cos(angle) * 0.5 * sign,
          ]
            .map((v) => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(6))
            .join(',');
        const prop = edge(cell, side, 'city-wall', random);
        boundary.push({ cell, prop, a: vertex(-1), b: vertex(1), clear: clear(cell, prop) });
      }
    }
    // Follow the outer perimeter, including cities spanning multiple hexes.
    const ordered = [boundary[0]];
    const remaining = new Set(boundary.slice(1));
    let end = ordered[0].b;
    while (remaining.size) {
      const next = [...remaining].find((item) => item.a === end || item.b === end);
      if (!next) break;
      remaining.delete(next);
      ordered.push(next);
      end = next.a === end ? next.b : next.a;
    }
    const start = Math.floor(random() * ordered.length);
    const wanted = random() < 0.5 ? 2 : 3;
    let chosen = [];
    for (let count = wanted; count >= 2 && !chosen.length; count--) {
      for (let offset = 0; offset < ordered.length; offset++) {
        const run = Array.from(
          { length: count },
          (_, k) => ordered[(start + offset + k) % ordered.length],
        );
        if (run.every((item) => item.clear)) {
          chosen = run;
          break;
        }
      }
    }
    for (const { cell, prop } of chosen) save(cell, prop);
  }
  return result;
}
