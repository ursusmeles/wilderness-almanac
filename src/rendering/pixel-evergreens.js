import { randomStream } from '../generation/math.js';
import { addMesh, geometryFrom } from './geometry.js';

const SIZE = 11;
const WIDTH = 0.48;
const BASE = 0.205;
const ROLES = ['leafDark', 'leaf', 'leafLight'];

// Solid stepped crowns retain the original prop transforms and palette roles.
export function evergreenCrown(variant, style) {
  const tall = variant === 2;
  const height = tall ? 1.065 : 0.945;
  const dims = [SIZE, Math.ceil((height - BASE) / (WIDTH / SIZE)), SIZE];
  const step = [WIDTH / SIZE, (height - BASE) / dims[1], WIDTH / SIZE];
  const origin = [-WIDTH / 2, BASE, -WIDTH / 2];
  const random = randomStream(1987 + style * 731 + variant * 2917);
  const phase = random() * Math.PI * 2;
  const lean = [(random() - 0.5) * 0.025, (random() - 0.5) * 0.025];
  const data = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const at = ([x, y, z]) =>
    x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]
      ? 0
      : data[(y * dims[2] + z) * dims[0] + x];
  for (let y = 0; y < dims[1]; y++) {
    const worldY = BASE + (y + 0.5) * step[1];
    const rise = (worldY - BASE) / (height - BASE);
    const lower = worldY <= 0.735 ? 0.24 * ((0.735 - worldY) / 0.53) : 0;
    const upperBase = tall ? 0.435 : 0.455;
    const upper =
      worldY >= upperBase ? (tall ? 0.16 : 0.19) * ((height - worldY) / (height - upperBase)) : 0;
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = origin[0] + (x + 0.5) * step[0] - lean[0] * rise;
        const dz = origin[2] + (z + 0.5) * step[2] - lean[1] * rise;
        const branch = Math.sin(Math.atan2(dz, dx) * 5 + phase + Math.floor(y / 3) * 0.8);
        const radius = Math.min(0.24, Math.max(lower, upper) * (1 + branch * 0.1));
        if (Math.hypot(dx, dz) <= Math.max(step[0] * 0.51, radius))
          data[(y * SIZE + z) * SIZE + x] = 1;
      }
    }
  }
  const points = ROLES.map(() => []);
  function shade(coords, axis, sign) {
    if (axis === 1 && sign < 0) return 1;
    const cluster =
      (Math.floor(coords[0] / 3) * 7 +
        Math.floor(coords[1] / 3) * 11 +
        Math.floor(coords[2] / 3) * 13 +
        style * 3) %
      17;
    let tone = axis === 1 ? 1 : axis === 0 ? (sign > 0 ? 1 : 0) : 1;
    if (cluster < 3) tone = Math.max(0, tone - 1);
    else if (cluster === 8) tone = Math.min(2, tone + 1);
    return tone + 1;
  }
  // Merge adjacent exposed voxel faces into rectangles, including hidden undersides.
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    const width = dims[u],
      depth = dims[v];
    for (const sign of [-1, 1]) {
      for (let slice = 0; slice < dims[axis]; slice++) {
        const mask = new Uint8Array(width * depth);
        for (let j = 0; j < depth; j++) {
          for (let i = 0; i < width; i++) {
            const coords = [];
            coords[axis] = slice;
            coords[u] = i;
            coords[v] = j;
            if (!at(coords)) continue;
            const next = coords.slice();
            next[axis] += sign;
            if (!at(next)) mask[j * width + i] = shade(coords, axis, sign);
          }
        }
        for (let j = 0; j < depth; j++) {
          for (let i = 0; i < width;) {
            const tone = mask[j * width + i];
            if (!tone) {
              i++;
              continue;
            }
            let w = 1,
              h = 1;
            while (i + w < width && mask[j * width + i + w] === tone) w++;
            row: while (j + h < depth) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * width + i + k] !== tone) break row;
              h++;
            }
            const p = origin.slice();
            p[axis] += (slice + (sign > 0 ? 1 : 0)) * step[axis];
            p[u] += i * step[u];
            p[v] += j * step[v];
            const a = p.slice(),
              b = p.slice(),
              c = p.slice();
            a[u] += w * step[u];
            b[u] += w * step[u];
            b[v] += h * step[v];
            c[v] += h * step[v];
            points[tone - 1].push(
              ...(sign > 0
                ? [...p, ...a, ...b, ...p, ...b, ...c]
                : [...p, ...b, ...a, ...p, ...c, ...b]),
            );
            for (let row = 0; row < h; row++)
              mask.fill(0, (j + row) * width + i, (j + row) * width + i + w);
            i += w;
          }
        }
      }
    }
  }
  return ROLES.map((role, index) => ({ role, points: points[index] }));
}

export function createPixelEvergreenBuilder({ propMaterial }) {
  const crowns = new Map();
  return (parent, prop) => {
    const variant = prop.variant === 2 ? 2 : 0;
    const style = ((prop.detailSeed ?? 0) >>> 0) % 8;
    const key = `${variant}:${style}`;
    if (!crowns.has(key)) crowns.set(key, evergreenCrown(variant, style));
    for (const { role, points } of crowns.get(key))
      if (points.length)
        addMesh(
          parent,
          geometryFrom(points),
          propMaterial(role, prop.temperature, prop.foliageTone),
        );
  };
}
