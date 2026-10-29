import * as THREE from 'three';
import { addMesh } from './geometry.js';
import { voxelFaces } from './pixel-foliage-geometry.js';

const templates = new Map();
function solidGeometry(key, dims, size, origin, contains, radialAxes = null, radius = 1) {
  if (!templates.has(key)) {
    const data = new Uint8Array(dims[0] * dims[1] * dims[2]);
    const step = size.map((length, i) => length / dims[i]);
    for (let y = 0; y < dims[1]; y++)
      for (let z = 0; z < dims[2]; z++)
        for (let x = 0; x < dims[0]; x++) {
          const point = [x, y, z].map((v, i) => origin[i] + (v + 0.5) * step[i]);
          if (contains(point)) data[(y * dims[2] + z) * dims[0] + x] = 1;
        }
    const faces = voxelFaces({ dims, size, origin, step, data, shade: () => 1 });
    const points = [],
      normals = [],
      indices = [];
    let reach = radius;
    if (radialAxes)
      for (const face of faces)
        for (let i = 0; i < face.points.length; i += 3)
          reach = Math.max(reach, Math.hypot(...radialAxes.map((axis) => face.points[i + axis])));
    for (const face of faces) {
      const start = points.length / 3;
      for (let i = 0; i < face.points.length; i++)
        points.push(face.points[i] * (radialAxes?.includes(i % 3) ? radius / reach : 1));
      for (let i = 0; i < 4; i++) normals.push(...face.normal);
      indices.push(
        ...(face.sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => start + i),
      );
    }
    if (templates.size >= 192) templates.delete(templates.keys().next().value);
    templates.set(key, { points, normals, indices });
  }
  const { points, normals, indices } = templates.get(key);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function pixelShape(source) {
  const p = source.parameters;
  if (!p) return source;
  const key = `${source.type}:${JSON.stringify(p)}`;
  let geometry;
  if (source.type === 'CylinderGeometry' || source.type === 'ConeGeometry') {
    const top = p.radiusTop ?? 0,
      bottom = p.radiusBottom ?? p.radius;
    const radius = Math.max(top, bottom),
      height = p.height;
    if (radius < 0.025 || (p.radialSegments === 4 && top === bottom)) {
      geometry = new THREE.BoxGeometry(radius * Math.SQRT2, height, radius * Math.SQRT2);
      if (p.radialSegments === 4) geometry.rotateY(Math.PI / 4);
    } else {
      const layers = Math.abs(top - bottom) > radius * 0.15 ? 5 : 1;
      const sides = p.radialSegments;
      const normals = Array.from({ length: sides }, (_, i) => {
        const angle = ((i + 0.5) * Math.PI * 2) / sides;
        return [Math.sin(angle), Math.cos(angle)];
      });
      geometry = solidGeometry(
        key,
        [9, layers, 9],
        [radius * 2, height, radius * 2],
        [-radius, -height / 2, -radius],
        ([x, y, z]) => {
          const r = bottom + (top - bottom) * (y / height + 0.5);
          return normals.every(
            ([nx, nz]) => x * nx + z * nz <= r * Math.cos(Math.PI / sides) + 1e-9,
          );
        },
        [0, 2],
        radius,
      );
    }
  } else if (
    ['DodecahedronGeometry', 'IcosahedronGeometry', 'SphereGeometry'].includes(source.type)
  ) {
    const radius = p.radius;
    geometry = solidGeometry(
      key,
      [5, 5, 5],
      [radius * 2, radius * 2, radius * 2],
      [-radius, -radius, -radius],
      (point) => point.reduce((sum, v) => sum + v * v, 0) <= radius * radius,
      [0, 1, 2],
      radius,
    );
  } else if (source.type === 'TorusGeometry' || source.type === 'CircleGeometry') {
    const ring = source.type === 'TorusGeometry',
      tube = ring ? p.tube : 0.001;
    const radius = p.radius + (ring ? tube : 0),
      inner = ring ? p.radius - tube : 0;
    geometry = solidGeometry(
      key,
      [12, 12, 1],
      [radius * 2, radius * 2, tube * 2],
      [-radius, -radius, -tube],
      ([x, y]) => Math.hypot(x, y) <= radius && Math.hypot(x, y) >= inner,
      [0, 1],
      radius,
    );
  }
  if (geometry) source.dispose();
  return geometry ?? source;
}

// Nearest-filtered colour cells on the dominant face plane, without extra faces.
export function pixelUV(
  geometry,
  { repeat = 0.32, offset = [0, 0, 0], horizontal = false, indexed = true } = {},
) {
  const points = geometry.attributes.position,
    normals = geometry.attributes.normal;
  const uvs = new Float32Array(points.count * 2);
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i) + offset[0],
      y = points.getY(i) + offset[1],
      z = points.getZ(i) + offset[2];
    const up =
      horizontal ||
      Math.abs(normals.getY(i)) >= Math.max(Math.abs(normals.getX(i)), Math.abs(normals.getZ(i)));
    uvs[i * 2] = (up ? x : Math.abs(normals.getX(i)) > Math.abs(normals.getZ(i)) ? z : x) / repeat;
    uvs[i * 2 + 1] = (up ? z : y) / repeat;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (indexed && !geometry.index)
    geometry.setIndex(Array.from({ length: points.count }, (_, i) => i));
  return geometry;
}

export function pixelModelMesh(parent, geometry, material, ...position) {
  return addMesh(parent, pixelUV(pixelShape(geometry)), material, ...position);
}

export function steppedRoofGeometry(width, depth, height) {
  return solidGeometry(
    `roof:${width}:${depth}:${height}`,
    [9, 5, 1],
    [width, height, depth],
    [-width / 2, 0, -depth / 2],
    ([x, y]) => Math.abs(x) <= (width / 2) * (1 - y / height),
  );
}
