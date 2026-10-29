import { BufferGeometry, Float32BufferAttribute } from 'three';
import { randomStream } from '../generation/math.js';
import { addMesh } from './geometry.js';
import { EVERGREEN_SPECIES as SPECIES, FOLIAGE_TONE_COUNT } from './pixel-foliage-colors.js';

const SIZE = 11;
const WIDTH = 0.48;

export function evergreenSpecies(prop, forest) {
  const type = forest?.family === 'deciduous' ? forest.neighbourType : forest?.type;
  const seed = (prop.detailSeed ?? 0) >>> 0;
  if (type === 'taiga') return ['spruce', 'spruce', 'fir', 'fir', 'pine'][seed % 5];
  return SPECIES.includes(type) ? type : SPECIES[seed % SPECIES.length];
}

const pineForms = new Map();
function pineForm(variant, style) {
  const key = `${variant}:${style}`;
  if (pineForms.has(key)) return pineForms.get(key);
  const height = variant === 2 ? 1.065 : 0.945;
  const random = randomStream(7183 + style * 1741 + variant * 2917);
  const phase = random() * Math.PI * 2;
  const drift = [Math.cos(phase) * 0.1, Math.sin(phase) * 0.08];
  const stem = [
    [0, 0, 0],
    [drift[0] * 0.25, height * 0.26, drift[1] * 0.1],
    [-drift[0] * 0.4, height * 0.5, drift[1] * 0.5],
    [drift[0] * 0.75, height * 0.72, drift[1] * 0.6],
    [drift[0], height * 0.86, drift[1]],
  ];
  const limbs = stem.slice(1).map((end, i) => ({ start: stem[i], end, radius: 0.034 - i * 0.006 }));
  const lobes = [{ center: stem[4], radius: [0.115, height * 0.14, 0.095], angle: phase }];
  const count = 4 + (style % 2);
  for (let i = 0; i < count; i++) {
    const level = height * (0.4 + i * 0.095);
    const segment = stem.findIndex((point, index) => index > 0 && point[1] >= level);
    const a = stem[segment - 1],
      b = stem[segment];
    const t = (level - a[1]) / (b[1] - a[1]);
    const start = a.map((value, axis) => value + (b[axis] - value) * t);
    const angle = phase + i * 2.4 + (random() - 0.5) * 0.5;
    const reach = 0.11 + random() * 0.035;
    const end = [
      start[0] + Math.cos(angle) * reach,
      height * (0.66 + i * 0.045 + random() * 0.04),
      start[2] + Math.sin(angle) * reach,
    ];
    const distance = Math.hypot(end[0], end[2]);
    if (distance > 0.115) {
      end[0] *= 0.115 / distance;
      end[2] *= 0.115 / distance;
    }
    const elbow = [
      start[0] + (end[0] - start[0]) * 0.55,
      level + height * 0.025,
      start[2] + (end[2] - start[2]) * 0.65,
    ];
    limbs.push({ start, end: elbow, radius: 0.018 }, { start: elbow, end, radius: 0.012 });
    lobes.push({
      center: end,
      radius: [
        0.105 + random() * 0.018,
        height * (0.085 + random() * 0.025),
        0.08 + random() * 0.02,
      ],
      angle,
    });
    lobes.push({
      center: elbow.map((value, axis) => value + (end[axis] - value) * 0.6),
      radius: [0.08, height * 0.07, 0.065],
      angle: angle + 0.4,
    });
  }
  const form = { height, base: height * 0.29, limbs, lobes };
  pineForms.set(key, form);
  return form;
}

export function evergreenForm(species, variant, style = 0) {
  if (species === 'pine') return pineForm(variant, style);
  const height = variant === 2 ? 1.065 : 0.945;
  return {
    height,
    base: 0.16,
    trunkHeight: 0.29,
  };
}

// Solid stepped crowns retain the original prop transforms and palette roles.
function crownFaces(species, variant, style) {
  const { height, base, lobes } = evergreenForm(species, variant, style);
  const dims = [SIZE, Math.ceil((height - base) / (WIDTH / SIZE)), SIZE];
  const step = [WIDTH / SIZE, (height - base) / dims[1], WIDTH / SIZE];
  const origin = [-WIDTH / 2, base, -WIDTH / 2];
  const random = randomStream(
    1987 + style * 731 + variant * 2917 + SPECIES.indexOf(species) * 1337,
  );
  const phase = random() * Math.PI * 2;
  const lean = [(random() - 0.5) * 0.025, (random() - 0.5) * 0.025];
  const tierOffset = style % 3;
  const branches = 5 + (style % 3);
  const data = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const at = ([x, y, z]) =>
    x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]
      ? 0
      : data[(y * dims[2] + z) * dims[0] + x];
  for (let y = 0; y < dims[1]; y++) {
    const worldY = base + (y + 0.5) * step[1];
    const rise = (worldY - base) / (height - base);
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = origin[0] + (x + 0.5) * step[0] - lean[0] * rise;
        const dz = origin[2] + (z + 0.5) * step[2] - lean[1] * rise;
        let filled;
        if (species === 'pine') {
          filled = lobes.some((lobe) => {
            const lx = dx - lobe.center[0],
              lz = dz - lobe.center[2];
            const u = lx * Math.cos(lobe.angle) + lz * Math.sin(lobe.angle);
            const v = lz * Math.cos(lobe.angle) - lx * Math.sin(lobe.angle);
            return (
              (u / lobe.radius[0]) ** 2 +
                (v / lobe.radius[2]) ** 2 +
                ((worldY - lobe.center[1]) / lobe.radius[1]) ** 2 <=
              1
            );
          });
        } else {
          const angle = Math.atan2(dz, dx);
          const tier = Math.floor((y + tierOffset) / 4);
          const branch = Math.sin(angle * branches + phase + tier * 0.55);
          const row = (y + tierOffset) % 4;
          const fir = species === 'fir';
          const envelope = (fir ? 0.24 : 0.205) * (1 - rise) ** (fir ? 0.8 : 1.05);
          const taper = fir ? 1 - row * 0.055 : 0.82 + row * 0.06;
          const radius = Math.min(0.24, envelope * taper * (1 + branch * (fir ? 0.09 : 0.17)));
          filled = Math.hypot(dx, dz) <= Math.max(step[0] * 0.51, radius);
        }
        if (filled) data[(y * SIZE + z) * SIZE + x] = 1;
      }
    }
  }
  const faces = [];
  function shade(coords, axis, sign) {
    if (axis === 1 && sign < 0) return 1;
    const [x, y, z] = coords;
    if (species === 'pine') {
      const patch =
        (Math.floor((x + tierOffset) / 2) + Math.floor(z / 2) * 3 + Math.floor(y / 2) * 2 + style) %
        7;
      let tone = [2, 3, 3, 4, 1, 3, 4][patch];
      if (axis === 1) tone = patch % 3 === 0 ? 4 : 3;
      if (tone === 4 && (x + z + style) % 4 === 0) tone = 5;
      return tone + 1;
    }
    const angle = Math.atan2(z + 0.5 - SIZE / 2, x + 0.5 - SIZE / 2);
    const sector = ((angle + phase) * branches) / (Math.PI * 2);
    const offset = (((Math.floor(sector) * 7 + style) % 3) + 3) % 3;
    const tierHeight = species === 'fir' ? 4 : 6;
    const tier = Math.floor((y + tierOffset + offset) / tierHeight);
    const row = (y + tierOffset + offset) % tierHeight;
    const fan = sector + tier * 0.37;
    const edge = Math.abs(fan - Math.floor(fan) - 0.5) * 2;
    // Stepped needle fans wrap around each branch tier. Their dark, hanging
    // edges connect into clusters instead of independent random pixel noise.
    const fringe = Math.floor(edge * 2);
    let tone = row <= fringe ? 1 : row === fringe + 1 ? 2 : edge < 0.45 ? 4 : 3;
    // Direct light already lifts the upward faces; reserve pale pixels for
    // branch tips instead of outlining every horizontal ledge in highlights.
    if (axis === 1) tone = edge > 0.7 ? 2 : row > 2 && edge < 0.4 ? 4 : 3;
    if (tone === 4 && edge < 0.3 && (x + z + tier + style) % 3 === 0) tone = 5;
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
            if (!at(next)) mask[j * width + i] = 1;
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
            const texels = [];
            for (let row = 0; row < h; row++)
              for (let col = 0; col < w; col++) {
                const coords = [];
                coords[axis] = slice;
                coords[u] = i + col;
                coords[v] = j + row;
                const tone = [0, 1, 2, 3, 6, 7][shade(coords, axis, sign) - 1];
                const patch =
                  (Math.floor(coords[0] / 2) +
                    Math.floor(coords[1] / 3) +
                    Math.floor(coords[2] / 2) * 3 +
                    style) %
                  5;
                const accent = tone === 3 && patch === 1 ? 4 : tone === 3 && patch === 3 ? 5 : tone;
                texels.push(SPECIES.indexOf(species) * FOLIAGE_TONE_COUNT + accent + 1);
              }
            faces.push({
              points: [...p, ...a, ...b, ...c],
              width: w,
              height: h,
              sign,
              normal: [0, 1, 2].map((direction) => (direction === axis ? sign : 0)),
              texels,
            });
            for (let row = 0; row < h; row++)
              mask.fill(0, (j + row) * width + i, (j + row) * width + i + w);
            i += w;
          }
        }
      }
    }
  }
  return faces;
}

let atlas;
// One numeric atlas for every seeded shape. Colour/lighting remain the material
// registry's responsibility; flat surfaces no longer need a quad per colour.
export function evergreenAtlas() {
  if (atlas) return atlas;
  const width = 256;
  let x = 0,
    y = 0,
    rowHeight = 0;
  const crowns = new Map();
  for (const species of SPECIES)
    for (const variant of [0, 2])
      for (let style = 0; style < 8; style++) {
        const faces = crownFaces(species, variant, style);
        crowns.set(`${species}:${variant}:${style}`, {
          faces,
          points: [],
          normals: [],
          uvs: [],
          indices: [],
        });
      }
  const patches = [...crowns.values()]
    .flatMap((crown) => crown.faces)
    .sort((a, b) => b.height - a.height || b.width - a.width);
  for (const face of patches) {
    if (x + face.width + 2 > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    face.x = x + 1;
    face.y = y + 1;
    x += face.width + 2;
    rowHeight = Math.max(rowHeight, face.height + 2);
  }
  const height = 2 ** Math.ceil(Math.log2(y + rowHeight));
  const indices = new Uint8Array(width * height);
  for (const crown of crowns.values()) {
    for (const face of crown.faces) {
      // A one-texel gutter protects adjacent atlas patches at their edges.
      for (let row = -1; row <= face.height; row++)
        for (let col = -1; col <= face.width; col++) {
          const u = Math.max(0, Math.min(face.width - 1, col));
          const v = Math.max(0, Math.min(face.height - 1, row));
          indices[(face.y + row) * width + face.x + col] = face.texels[v * face.width + u];
        }
      const p = [face.x / width, face.y / height];
      const a = [(face.x + face.width) / width, p[1]];
      const b = [a[0], (face.y + face.height) / height];
      const c = [p[0], b[1]];
      const start = crown.points.length / 3;
      crown.points.push(...face.points);
      for (let corner = 0; corner < 4; corner++) crown.normals.push(...face.normal);
      crown.uvs.push(...p, ...a, ...b, ...c);
      const order = face.sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      crown.indices.push(...order.map((index) => start + index));
    }
    delete crown.faces;
  }
  atlas = { width, height, indices, crowns };
  return atlas;
}

export function createPixelEvergreenBuilder({ pixelMaterial }) {
  return (parent, prop, species) => {
    const variant = prop.variant === 2 ? 2 : 0;
    const style = ((prop.detailSeed ?? 0) >>> 0) % 8;
    const key = `${species}:${variant}:${style}`;
    const crown = evergreenAtlas().crowns.get(key);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(crown.points, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(crown.normals, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(crown.uvs, 2));
    geometry.setIndex(crown.indices);
    addMesh(parent, geometry, pixelMaterial(prop.temperature, prop.foliageTone));
  };
}
