import { randomStream } from './math.js';

// Cosmetic relief belongs to each reserved crop footprint, leaving roads,
// neighbouring tiles and gameplay elevation unchanged. Old plots remain flat.
export function isVineyard(cell, props = cell.props) {
  return (
    cell.terrain === 'farmlands' && Boolean(props?.some((prop) => prop.cropStyle === 'vineyard'))
  );
}

export function polygonArea(points) {
  return (
    Math.abs(
      points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length];
        return sum + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2
  );
}

export function clipField(points, nx, nz, limit) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = a[0] * nx + a[1] * nz - limit,
      db = b[0] * nx + b[1] * nz - limit;
    if (da <= 0) result.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

// Positive inside, negative outside; polygons are convex and counterclockwise.
export function fieldInset(points, x, z) {
  let distance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    distance = Math.min(distance, (dx * (z - a[1]) - dz * (x - a[0])) / Math.hypot(dx, dz));
  }
  return distance;
}

export function fieldDistance(prop, x, z) {
  const c = Math.cos(prop.angle),
    s = Math.sin(prop.angle),
    scale = prop.scale;
  const px = ((x - prop.x) * c - (z - prop.z) * s) / scale;
  const pz = ((x - prop.x) * s + (z - prop.z) * c) / scale;
  if (fieldInset(prop.patch, px, pz) >= 0) return 0;
  let distance = Infinity;
  for (let i = 0; i < prop.patch.length; i++) {
    const a = prop.patch[i],
      b = prop.patch[(i + 1) % prop.patch.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t));
  }
  return distance * scale;
}

export function fieldIntersectsSegment(prop, a, b, margin) {
  const local = ([x, z]) => {
    const dx = x - prop.x,
      dz = z - prop.z;
    return [
      (dx * Math.cos(prop.angle) - dz * Math.sin(prop.angle)) / prop.scale,
      (dx * Math.sin(prop.angle) + dz * Math.cos(prop.angle)) / prop.scale,
    ];
  };
  const start = local(a),
    end = local(b);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < prop.patch.length; i++) {
    const p = prop.patch[i],
      q = prop.patch[(i + 1) % prop.patch.length];
    const nx = q[1] - p[1],
      nz = p[0] - q[0];
    const from =
      (start[0] - p[0]) * nx + (start[1] - p[1]) * nz - (margin / prop.scale) * Math.hypot(nx, nz);
    const delta = (end[0] - start[0]) * nx + (end[1] - start[1]) * nz;
    if (Math.abs(delta) < 1e-12) {
      if (from > 0) return false;
    } else if (delta > 0) hi = Math.min(hi, -from / delta);
    else lo = Math.max(lo, -from / delta);
    if (lo > hi) return false;
  }
  return true;
}

export function cropHeight(prop, x, z) {
  if (prop.patch) {
    const weight = Math.max(0, Math.min(1, fieldInset(prop.patch, x, z) / 0.16));
    return (
      weight *
      weight *
      (3 - 2 * weight) *
      (0.035 + 0.012 * Math.sin(x * 4 + z * 2 + prop.detailSeed))
    );
  }
  if (!prop.cropStyle || prop.cropStyle === 'plots') return 0;
  const edge = Math.max(0, 1 - (x / 0.18) ** 2) * Math.max(0, 1 - (z / 0.2) ** 2);
  return edge * (0.035 + (prop.detailSeed % 7) * 0.003) * (1 + x * 0.8);
}

// A close, staggered carpet covers the entire clipped patch, including its
// irregular corners. Seed jitter breaks rows without leaving large bare gaps.
export function* grainPlants(prop) {
  const random = randomStream(prop.detailSeed),
    spacing = 0.02;
  const xs = prop.patch.map((p) => p[0]),
    zs = prop.patch.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  let row = 0;
  for (let z = minZ + spacing / 2; z < maxZ; z += spacing, row++)
    for (let x = minX + spacing / 2 + ((row % 2) * spacing) / 2; x < maxX; x += spacing) {
      const px = x + (random() - 0.5) * 0.004,
        pz = z + (random() - 0.5) * 0.004;
      if (fieldInset(prop.patch, px, pz) < 0.019) continue;
      yield {
        x: px,
        z: pz,
        y: cropHeight(prop, px, pz) + 0.004,
        height: 0.085 + random() * 0.03,
        lean: (random() - 0.5) * 0.01,
      };
    }
}
