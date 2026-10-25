import { TOP_RADIUS, randomStream } from './math.js';
import { TOKEN_ANCHOR } from './forest-props.js';
import { clipField, polygonArea, fieldInset } from './farmland-patches.js';

function hull(points) {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (input) => {
    const result = [];
    for (const p of input) {
      while (result.length >= 2 && cross(result.at(-2), result.at(-1), p) <= 1e-10) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

const circle = (x, z, radius) =>
  Array.from({ length: 10 }, (_, i) => {
    const angle = (i * Math.PI) / 5,
      r = radius / Math.cos(Math.PI / 10);
    return [x + Math.cos(angle) * r, z + Math.sin(angle) * r];
  });

// Subtract one convex reservation, retaining convex pieces around its edges.
function subtract(polygon, obstacle) {
  let overlap = polygon;
  for (let i = 0; i < obstacle.length && overlap.length; i++) {
    const a = obstacle[i],
      b = obstacle[(i + 1) % obstacle.length];
    const nx = b[1] - a[1],
      nz = a[0] - b[0];
    overlap = clipField(overlap, nx, nz, a[0] * nx + a[1] * nz);
  }
  if (overlap.length < 3 || polygonArea(overlap) < 1e-9) return [polygon];
  let inside = polygon;
  const outside = [];
  for (let i = 0; i < obstacle.length && inside.length; i++) {
    const a = obstacle[i],
      b = obstacle[(i + 1) % obstacle.length];
    const nx = b[1] - a[1],
      nz = a[0] - b[0],
      limit = a[0] * nx + a[1] * nz;
    const piece = clipField(inside, -nx, -nz, -limit);
    if (piece.length >= 3 && polygonArea(piece) > 0.018) outside.push(piece);
    inside = clipField(inside, nx, nz, limit);
  }
  return outside;
}

function mergePieces(pieces) {
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const merged = hull([...pieces[i], ...pieces[j]]);
      if (
        merged.length > 24 ||
        polygonArea(merged) > polygonArea(pieces[i]) + polygonArea(pieces[j]) + 1e-7
      )
        continue;
      pieces[i] = merged;
      pieces.splice(j, 1);
      i = -1;
      break;
    }
  return pieces;
}

export function generateGrainFields(cell, detailSeed, props) {
  const random = randomStream(detailSeed),
    count = 3 + Math.floor(random() * 2);
  const angle = random() * Math.PI * 2;
  const sites = Array.from({ length: count }, (_, i) => {
    const a = angle + ((i + (random() - 0.5) * 0.3) * Math.PI * 2) / count;
    const radius = 0.32 + random() * 0.12;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  });
  const boundary = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3;
    return [Math.cos(a) * (TOP_RADIUS - 0.035), Math.sin(a) * (TOP_RADIUS - 0.035)];
  });
  // Rotate the hex to match the pointy-top map geometry, then retain CCW order.
  for (const point of boundary) [point[0], point[1]] = [-point[1], point[0]];
  const obstacles = [circle(TOKEN_ANCHOR.x, TOKEN_ANCHOR.z, TOKEN_ANCHOR.r + 0.055)];
  for (const prop of props)
    obstacles.push(circle(prop.x, prop.z, prop.footprint + (prop.kind === 'poi' ? 0.045 : 0.035)));
  for (const path of cell.roads ?? [])
    obstacles.push(hull(path.points.flatMap(([x, z]) => circle(x, z, path.width + 0.045))));
  const result = [];
  for (const site of sites) {
    let polygon = boundary;
    for (const other of sites) {
      if (other === site) continue;
      const nx = other[0] - site[0],
        nz = other[1] - site[1];
      const limit = (other[0] ** 2 + other[1] ** 2 - site[0] ** 2 - site[1] ** 2) / 2;
      polygon = clipField(polygon, nx, nz, limit - Math.hypot(nx, nz) * 0.012);
    }
    let pieces = [polygon];
    for (const obstacle of obstacles) pieces = pieces.flatMap((piece) => subtract(piece, obstacle));
    for (const piece of mergePieces(pieces)) {
      if (piece.length < 3 || piece.length > 24 || polygonArea(piece) < 0.035) continue;
      const x = piece.reduce((sum, p) => sum + p[0], 0) / piece.length;
      const z = piece.reduce((sum, p) => sum + p[1], 0) / piece.length;
      const patch = piece.map(([px, pz]) => [px - x, pz - z]);
      // Discard tiny slivers that cannot fit even one complete wheat head.
      if (fieldInset(patch, 0, 0) < 0.027) continue;
      result.push({
        kind: 'crops',
        cropStyle: 'grain',
        patch,
        x,
        y: 0,
        z,
        scale: 1,
        angle: 0,
        footprint: Math.max(...patch.map((p) => Math.hypot(...p))),
        detailSeed: Math.floor(random() * 1000000),
        variant: Math.floor(random() * 3),
        temperature: 2 / 3,
      });
    }
  }
  return result.toSorted((a, b) => polygonArea(b.patch) - polygonArea(a.patch)).slice(0, 24);
}
