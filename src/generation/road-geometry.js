import { randomFor } from './seed.js';
import { DIRECTIONS, directionTo } from './hex.js';
import { TOP_RADIUS, surfaceHeight } from './math.js';
import { poiAnchor } from './points-of-interest.js';
import { roadKey } from './roads.js';
import { fieldIntersectsSegment } from './farmland-patches.js';

const APOTHEM = Math.sqrt(3) / 2;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const top = (cell) => (cell.water ? 0.34 : 0.34 + cell.elevation * 0.22);
export const hexRadius = (x, z) =>
  Math.max(
    ...DIRECTIONS.map(
      (_, side) =>
        (x * Math.cos((side * Math.PI) / 3) + z * Math.sin((side * Math.PI) / 3)) / APOTHEM,
    ),
  );
const bevel = (x, z) => -0.075 * clamp((hexRadius(x, z) - TOP_RADIUS) / (1 - TOP_RADIUS));

export function roadPort(world, cell, next) {
  const side = directionTo(cell, next),
    angle = (side * Math.PI) / 3;
  const offset =
    cell.water || next.water
      ? 0
      : (randomFor(world.seed, `road-port:${roadKey(cell.key, next.key)}`)() - 0.5) *
        0.32 *
        (cell.key < next.key ? 1 : -1);
  return {
    side,
    offset,
    x: Math.cos(angle) * APOTHEM - Math.sin(angle) * offset,
    z: Math.sin(angle) * APOTHEM + Math.cos(angle) * offset,
  };
}

// Local earth cuts/ramps meet at the same height on both sides of a shared
// edge. They change only dressing geometry, never elevation or route topology.
function rampOffset(ramps, x, z) {
  let result = 0;
  for (const ramp of ramps) {
    const angle = (ramp.side * Math.PI) / 3;
    const inward = APOTHEM - x * Math.cos(angle) - z * Math.sin(angle);
    const sideways = Math.abs(-x * Math.sin(angle) + z * Math.cos(angle) - ramp.offset);
    result += ramp.delta * smooth(1 - inward / 0.46) * smooth((0.19 - sideways) / 0.08);
  }
  return result;
}

function rampSurface(cell, ramps) {
  if (!ramps.length) return null;
  const vertices = [],
    triangles = [],
    materialIndices = [];
  const count = 72;
  const boundary = (i) => {
    const side = Math.floor(i / 12),
      t = (i % 12) / 12;
    const a = (side * Math.PI) / 3,
      b = ((side + 1) * Math.PI) / 3;
    return [Math.sin(a) * (1 - t) + Math.sin(b) * t, Math.cos(a) * (1 - t) + Math.cos(b) * t];
  };
  const rings = [
    [0.955, 0],
    [1, 0.045],
    [1, top(cell) - 0.075],
    [TOP_RADIUS, top(cell)],
    [0.72, top(cell)],
    [0.48, top(cell)],
  ];
  rings.forEach(([radius, height], ring) => {
    for (let i = 0; i < count; i++) {
      const [x, z] = boundary(i).map((v) => v * radius);
      vertices.push([x, height + (ring >= 2 ? rampOffset(ramps, x, z) : 0), z]);
    }
  });
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let i = 0; i < count; i++) {
      const a = ring * count + i,
        b = ring * count + ((i + 1) % count);
      triangles.push([a, b, a + count], [b, b + count, a + count]);
      materialIndices.push(ring < 2 ? 0 : ring === 2 ? 1 : 2, ring < 2 ? 0 : ring === 2 ? 1 : 2);
    }
  const center = vertices.length;
  vertices.push([0, top(cell), 0]);
  for (let i = 0; i < count; i++) {
    triangles.push([center, 5 * count + i, 5 * count + ((i + 1) % count)]);
    materialIndices.push(2);
  }
  return {
    vertices,
    triangles,
    materialIndices,
    topTriangles: triangles.filter((_, i) => materialIndices[i] !== 0),
  };
}

export function roadHeight(cell, x, z, surface) {
  if (surface)
    return (
      surfaceHeight({ vertices: surface.vertices, triangles: surface.topTriangles }, x, z) -
      top(cell)
    );
  return (cell.water === 'river' ? 0.14 : 0) + bevel(x, z);
}

export function generateRoadDressing(world, variant, { fixedCells = {}, revisions = {} } = {}) {
  const result = new Map();
  if (!world.roads) return result;
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  for (const cell of world.cells) {
    if (!cell.road) continue;
    const roadShape = fixedCells[cell.key]?.roadShape ?? {
      variant,
      revision: revisions[cell.key] ?? 0,
    };
    const random = randomFor(
      world.seed,
      `road-shape:${cell.key}:${roadShape.variant}:${roadShape.revision}`,
    );
    const angle = random() * Math.PI * 2,
      radius = 0.08 + random() * 0.42;
    const hub = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    const ports = [],
      ramps = [];
    for (let side = 0; side < 6; side++) {
      if (!(cell.road.exits & (1 << side))) continue;
      const [q, r] = DIRECTIONS[side],
        next = byKey.get(`${cell.q + q},${cell.r + r}`);
      const port = roadPort(world, cell, next);
      ports.push(port);
      if (!cell.water && cell.elevation !== next.elevation) {
        const delta = next.water ? top(next) - top(cell) : (top(next) - top(cell)) / 2;
        ramps.push({ ...port, delta });
      }
    }
    const paths = [],
      stones = [];
    const pairs = ports
      .flatMap((a, i) =>
        ports.slice(i + 1).map((b) => ({
          a,
          b,
          distance: Math.hypot(b.x - a.x, b.z - a.z),
        })),
      )
      .sort((a, b) => b.distance - a.distance);
    const main = pairs[0];
    const axis = main
      ? [(main.b.x - main.a.x) / main.distance, (main.b.z - main.a.z) / main.distance]
      : null;
    for (const port of ports) {
      const normal = (port.side * Math.PI) / 3;
      let end = hub;
      const bank = cell.road.banks[port.side];
      const poi = cell.pointsOfInterest[0];
      if (bank) end = cell.crossing[bank];
      else if (cell.pointOfLight)
        end = [port.x - Math.cos(normal) * 0.28, port.z - Math.sin(normal) * 0.28];
      else if (poi) {
        const anchor = poiAnchor(poi),
          d = Math.hypot(port.x - anchor.x, port.z - anchor.z);
        end = [
          anchor.x + ((port.x - anchor.x) / d) * (anchor.r + 0.045),
          anchor.z + ((port.z - anchor.z) / d) * (anchor.r + 0.045),
        ];
      }
      const length = Math.hypot(end[0] - port.x, end[1] - port.z);
      const bend = (random() - 0.5) * (0.09 + cell.elevation * 0.055);
      const turns = cell.elevation > 1 ? 2 : 1;
      const points = [];
      const terminal = bank || cell.pointOfLight || poi;
      const tangent =
        !terminal && axis ? axis : [(end[0] - port.x) / length, (end[1] - port.z) / length];
      let sign = (end[0] - port.x) * tangent[0] + (end[1] - port.z) * tangent[1] >= 0 ? 1 : -1;
      if (!terminal && main) {
        if (port === main.a) sign = 1;
        if (port === main.b) sign = -1;
      }
      const control = [
        port.x - Math.cos(normal) * length * 0.38,
        port.z - Math.sin(normal) * length * 0.38,
      ];
      // Opposing branches share a tangent, so the road passes through a hex
      // smoothly. Side branches merge into that same axis at a junction.
      const approach = [
        end[0] - tangent[0] * sign * length * 0.3,
        end[1] - tangent[1] * sign * length * 0.3,
      ];
      for (let step = 0; step <= 32; step++) {
        const t = step / 32,
          u = 1 - t;
        const point = [0, 1].map(
          (axis) =>
            u ** 3 * port[axis === 0 ? 'x' : 'z'] +
            3 * u * u * t * control[axis] +
            3 * u * t * t * approach[axis] +
            t ** 3 * end[axis],
        );
        if (!bank) {
          const wave = Math.sin(t * Math.PI * turns) * Math.sin(t * Math.PI) ** 2 * bend;
          point[0] += (-(end[1] - port.z) / length) * wave;
          point[1] += ((end[0] - port.x) / length) * wave;
        } else {
          // The routing graph checked this exact straight dry-bank approach.
          point[0] = port.x * u + end[0] * t;
          point[1] = port.z * u + end[1] * t;
        }
        points.push(point);
      }
      paths.push({ points, width: bank ? 0.016 : 0.022 });
      for (let i = 0; i < 2; i++) {
        if (random() > 0.6) continue;
        const p = points[5 + Math.floor(random() * 20)];
        stones.push({ x: p[0], z: p[1], scale: 0.006 + random() * 0.005 });
      }
    }
    result.set(cell.key, {
      roadShape,
      roadMask: cell.road.exits,
      roads: paths,
      roadStones: stones,
      roadSurface: rampSurface(cell, ramps),
    });
  }
  return result;
}

export function roadDistance(paths, x, z) {
  let distance = Infinity;
  for (const path of paths ?? [])
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = dx * dx + dz * dz;
      const t = length ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / length) : 0;
      distance = Math.min(distance, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
  return distance;
}

export function roadAllowsProp(paths, prop) {
  if (!paths?.length || ['poi', 'rock', 'grass'].includes(prop.kind)) return true;
  if (prop.patch)
    return paths.every((path) =>
      path.points
        .slice(1)
        .every(
          (point, i) => !fieldIntersectsSegment(prop, path.points[i], point, path.width + 0.035),
        ),
    );
  return (
    roadDistance(paths, prop.x, prop.z) > (prop.kind === 'tree' ? 0.035 : prop.footprint) + 0.035
  );
}

// Split a wall/fence around the road instead of erasing its entire side.
export function roadBarrierPieces(paths, prop) {
  if (!paths?.length) return [prop];
  const steps = 80,
    pieces = [];
  let start;
  const point = (t) => [
    prop.x + Math.cos(prop.angle) * prop.length * (t - 0.5),
    prop.z + Math.sin(prop.angle) * prop.length * (t - 0.5),
  ];
  if (
    Array.from({ length: steps + 1 }, (_, i) => point(i / steps)).every(
      (p) => roadDistance(paths, ...p) > 0.09,
    )
  )
    return [prop];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      p = point(t);
    const clear = i < steps && roadDistance(paths, ...p) > 0.09;
    if (clear && start === undefined) start = t;
    if (!clear && start !== undefined) {
      const length = (t - start) * prop.length;
      if (length > 0.1) {
        const middle = point((start + t) / 2);
        pieces.push({ ...prop, x: middle[0], z: middle[1], length });
      }
      start = undefined;
    }
  }
  return pieces;
}
