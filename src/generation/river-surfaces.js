import { TOP_RADIUS } from './math.js';

const APOTHEM = Math.sqrt(3) / 2;
const hexRadius = (x, z) =>
  Math.max(Math.abs(x), Math.abs(x * 0.5 + z * APOTHEM), Math.abs(x * 0.5 - z * APOTHEM)) / APOTHEM;

function tubeValue(x, z, segment) {
  const [a, b, ra, rb] = segment,
    dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - (ra + (rb - ra) * t);
}
function riverBankValue(river, x, z) {
  if (river.mouths) {
    let land = -Infinity;
    for (const mouth of river.mouths) {
      const dx = x - mouth.x,
        dz = z - mouth.z;
      const depth = dx * mouth.nx + dz * mouth.nz;
      const across = dx * -mouth.nz + dz * mouth.nx;
      if (depth < -1e-7) continue;
      // Two rounded banks continue across the shared edge. The opening grows
      // inside open water, with zero initial flare and no straight clipped end.
      const width = mouth.width + 0.8 * (depth / 0.65) ** 2;
      const rim = 0.5 - Math.hypot(across, depth * 0.8);
      const texture =
        (river.roughness ?? 1) *
        (0.048 * Math.sin(x * 2.7 + z * 1.3 + river.phase) +
          0.023 * Math.sin(z * 4.1 - x * 1.7 - river.phase));
      land = Math.max(land, Math.min(Math.abs(across) - width + texture, rim));
    }
    return land;
  }
  let value = Infinity;
  for (const segment of river.channel) value = Math.min(value, tubeValue(x, z, segment));
  let bank =
    value +
    (river.roughness ?? 1) * 0.048 * Math.sin(x * 2.7 + z * 1.3 + river.phase) +
    (river.roughness ?? 1) * 0.023 * Math.sin(z * 4.1 - x * 1.7 - river.phase);
  // Keep a continuous land rim wherever the river meets a dry neighbour. The
  // barriers are world-space segments shared by both sides of every mesh seam.
  for (const [a, b] of river.bankBarriers ?? []) {
    bank = Math.max(bank, 0.065 - tubeValue(x, z, [a, b, 0, 0]));
  }
  return bank;
}
function riverIslandValue(river, x, z) {
  let value = -Infinity;
  for (const segment of river.islands) value = Math.max(value, -tubeValue(x, z, segment));
  return value;
}
function riverLandValue(river, x, z) {
  return Math.max(riverBankValue(river, x, z), riverIslandValue(river, x, z));
}
function riverBankHeight(river, x, z) {
  if (Number.isFinite(river.bankHeight)) return river.bankHeight;
  let weight = 0,
    height = 0;
  for (const edge of river.landEdges) {
    const [a, b, ha, hb] = edge,
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))),
      distance = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    if (distance < 1e-7) return ha + (hb - ha) * t;
    const w = 1 / Math.pow(distance + 0.002, 5);
    weight += w;
    height += (ha + (hb - ha) * t) * w;
  }
  return weight ? height / weight : 0.14;
}
function riverTopHeight(cell, x, z) {
  const height = riverBankHeight(cell.river, cell.wx + x, cell.wz + z);
  if (!cell.bankBevel) return height;
  const radius = hexRadius(x, z);
  // Match the ordinary tile: top at radius .92, outer edge .075 lower.
  return height - 0.075 * Math.max(0, Math.min(1, (radius - TOP_RADIUS) / (1 - TOP_RADIUS)));
}
function insideRiverTile(cell, x, z, margin = 0) {
  for (let k = 0; k < 6; k++) {
    const a = cell.riverCorners[k],
      b = cell.riverCorners[(k + 1) % 6],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    if ((x - a[0]) * dz - (z - a[1]) * dx < margin * Math.hypot(dx, dz) - 1e-9) return false;
  }
  return true;
}
// Clip planar bank tops at the exact shoreline, then add vertical cliff faces.
// No submerged, triangulated slope crosses the water plane.
function riverSurface(cell) {
  const vertices = [],
    triangles = [],
    shore = [],
    lookup = new Map(),
    n = 28,
    corners = cell.riverCorners,
    waterVertices = [],
    waterTriangles = [],
    waterLookup = new Map(),
    materialIndices = [];
  function raw(x, z) {
    return { x, z, v: riverLandValue(cell.river, cell.wx + x, cell.wz + z) };
  }
  function intersection(a, b) {
    const t = a.v / (a.v - b.v);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, v: 0 };
  }
  function vertex(p) {
    const key = p.x.toFixed(8) + ',' + p.z.toFixed(8);
    if (lookup.has(key)) return lookup.get(key);
    const x = cell.wx + p.x,
      z = cell.wz + p.z,
      island = riverIslandValue(cell.river, x, z),
      bank = riverBankValue(cell.river, x, z),
      y = island > bank ? 0.045 : riverTopHeight(cell, p.x, p.z),
      index = vertices.length;
    vertices.push([p.x, y, p.z]);
    lookup.set(key, index);
    return index;
  }
  function triangle(points) {
    const bevel =
      cell.bankBevel && points.some((point) => hexRadius(point.x, point.z) > TOP_RADIUS + 1e-8);
    const clipped = [],
      cross = [];
    for (let i = 0; i < 3; i++) {
      const a = points[i],
        b = points[(i + 1) % 3];
      if (a.v >= 0) clipped.push(a);
      if ((a.v < 0 && b.v >= 0) || (a.v >= 0 && b.v < 0)) {
        const p = intersection(a, b);
        clipped.push(p);
        cross.push(p);
      }
    }
    if (clipped.length >= 3) {
      const a = vertex(clipped[0]);
      for (let k = 1; k < clipped.length - 1; k++) {
        triangles.push([a, vertex(clipped[k]), vertex(clipped[k + 1])]);
        materialIndices.push(bevel ? 1 : 0);
      }
    }
    if (cross.length === 2) shore.push(cross.map((p) => vertices[vertex(p)]));
    if (cell.clipWater) {
      const wet = [];
      for (let i = 0; i < 3; i++) {
        const a = points[i],
          b = points[(i + 1) % 3];
        if (a.v <= 0) wet.push(a);
        if ((a.v < 0 && b.v > 0) || (a.v > 0 && b.v < 0)) wet.push(intersection(a, b));
      }
      const indexOf = (p) => {
        const key = p.x.toFixed(8) + ',' + p.z.toFixed(8);
        if (!waterLookup.has(key)) {
          waterLookup.set(key, waterVertices.length);
          waterVertices.push([p.x, 0, p.z]);
        }
        return waterLookup.get(key);
      };
      for (let i = 1; i < wet.length - 1; i++)
        waterTriangles.push([indexOf(wet[0]), indexOf(wet[i]), indexOf(wet[i + 1])]);
    }
  }
  const rawLookup = new Map(),
    atPoint = (x, z) => {
      const key = x.toFixed(8) + ',' + z.toFixed(8);
      if (!rawLookup.has(key)) rawLookup.set(key, raw(x, z));
      return rawLookup.get(key);
    };
  for (let k = 0; k < 6; k++) {
    const a = corners[k],
      b = corners[(k + 1) % 6],
      at = (i, j) => {
        if (!cell.bankBevel) return atPoint((i * a[0] + j * b[0]) / n, (i * a[1] + j * b[1]) / n);
        const ring = i + j;
        if (!ring) return atPoint(0, 0);
        // Put an exact mesh ring at the same .92 crease as the land tile.
        const innerRings = n - 2;
        const radius =
          ring <= innerRings
            ? (TOP_RADIUS * ring) / innerRings
            : TOP_RADIUS + ((1 - TOP_RADIUS) * (ring - innerRings)) / 2;
        return atPoint(
          ((i * a[0] + j * b[0]) / ring) * radius,
          ((i * a[1] + j * b[1]) / ring) * radius,
        );
      };
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n - i; j++) {
        triangle([at(i, j), at(i + 1, j), at(i, j + 1)]);
        if (i + j < n - 1) triangle([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
  }
  const surface = { vertices, triangles, shore };
  if (cell.clipWater) surface.water = { vertices: waterVertices, triangles: waterTriangles };
  if (cell.bankBevel) surface.materialIndices = materialIndices;
  return surface;
}

export {
  riverBankValue,
  riverIslandValue,
  riverLandValue,
  riverBankHeight,
  riverTopHeight,
  insideRiverTile,
  riverSurface,
};
