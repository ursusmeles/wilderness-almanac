// Continuous height field and faceted mesh shared by connected mountain tiles.
function smoothstep(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function ridgeHeight(range, x, z) {
  let edgeDistance = Infinity;
  for (const [a, b] of range.boundary)
    edgeDistance = Math.min(edgeDistance, segmentDistance(x, z, a, b));
  if (range.ridges) {
    const { main, branches, width, ruggedness, relief, detail } = range.ridges;
    const distanceTo = (segments) => {
      let distance = Infinity;
      for (const [a, b] of segments) distance = Math.min(distance, segmentDistance(x, z, a, b));
      return distance;
    };
    const broad = relief(x, z),
      summit = detail(x, z);
    const localWidth = width * (0.8 + broad * 0.4);
    const crest = Math.exp(-Math.pow(distanceTo(main) / localWidth, 2.3 - ruggedness));
    const spur = Math.exp(-Math.pow(distanceTo(branches) / (localWidth * 0.75), 1.8));
    const height =
      0.13 +
      broad * 0.08 +
      Math.max(
        crest * (0.44 + broad * 0.38 + summit * (0.12 + ruggedness * 0.65)),
        spur * (0.38 + broad * 0.24 + summit * 0.15),
      );
    return (
      height * (0.68 + ruggedness * 0.4) * smoothstep(0, 0.57 - ruggedness * 0.1, edgeDistance)
    );
  }
  let backboneDistance = Infinity;
  for (const [a, b] of range.spines)
    backboneDistance = Math.min(backboneDistance, segmentDistance(x, z, a, b));
  const c = Math.cos(range.angle),
    s = Math.sin(range.angle),
    u = x * c + z * s,
    v = -x * s + z * c;
  const rolling =
    0.57 +
    0.1 * Math.sin(u * 2.3 + range.phase) +
    0.055 * Math.cos(v * 3.1 - u * 0.8 + range.phase);
  const broadRidge = rolling * Math.exp(-Math.pow(backboneDistance / 0.7, 2)) + 0.14;
  const texture = 0.014 * Math.sin(x * 8.1 + range.phase) * Math.sin(z * 6.7 - range.phase);
  return Math.max(0, broadRidge + texture) * smoothstep(0, 0.57, edgeDistance);
}
function ridgeSurface(cell, range) {
  const vertices = [],
    triangles = [],
    lookup = new Map(),
    n = 8,
    corners = cell.corners;
  function vertex(x, z, onBoundary) {
    const key =
      (Math.abs(x) < 1e-6 ? 0 : x).toFixed(7) + ',' + (Math.abs(z) < 1e-6 ? 0 : z).toFixed(7);
    if (lookup.has(key)) return lookup.get(key);
    if (!onBoundary && Math.hypot(x, z) > 0.01) {
      const salt = (x + cell.wx) * 197 + (z + cell.wz) * 313 + range.phase;
      x += Math.sin(salt * 7) * 0.014;
      z += Math.cos(salt * 11) * 0.014;
    }
    const index = vertices.length;
    vertices.push([x, ridgeHeight(range, cell.wx + x, cell.wz + z), z]);
    lookup.set(key, index);
    return index;
  }
  for (let sector = 0; sector < 6; sector++) {
    const A = corners[sector],
      B = corners[(sector + 1) % 6];
    const at = (i, j) => vertex((i * A[0] + j * B[0]) / n, (i * A[1] + j * B[1]) / n, i + j === n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n - i; j++) {
        triangles.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
        if (i + j < n - 1) triangles.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
  }
  return { vertices, triangles };
}

export { ridgeSurface };
