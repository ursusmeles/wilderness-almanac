import { BufferGeometry, Float32BufferAttribute } from 'three';
import { voxelFaces, packFoliageAtlas, crownGeometry } from './pixel-foliage-geometry.js';

let atlas;
function dressingAtlas() {
  if (atlas) return atlas;
  const forms = new Map();
  for (const kind of ['rock', 'vine', 'puddle'])
    for (let style = 0; style < 12; style++) {
      const dims = kind === 'puddle' ? [12, 1, 8] : kind === 'vine' ? [5, 3, 3] : [5, 4, 5];
      const size =
        kind === 'puddle'
          ? [2, 0.008, 1.4]
          : kind === 'vine'
            ? [0.13, 0.075, 0.09]
            : [2, 0.95, 1.6];
      const origin = [-size[0] / 2, kind === 'puddle' ? 0.002 : 0, -size[2] / 2];
      const data = new Uint8Array(dims[0] * dims[1] * dims[2]);
      for (let y = 0; y < dims[1]; y++)
        for (let z = 0; z < dims[2]; z++)
          for (let x = 0; x < dims[0]; x++) {
            const u = ((x + 0.5) / dims[0]) * 2 - 1 + ((style % 3) - 1) * 0.055;
            const v = ((z + 0.5) / dims[2]) * 2 - 1;
            const h = (y + 0.5) / dims[1];
            const edge = kind === 'puddle' ? 0.8 + Math.sin(z * 1.7 + style) * 0.09 : 1;
            const profile =
              kind === 'rock'
                ? (u * u + v * v) * (0.7 + h * 0.75) + h * h * (0.65 + (style % 3) * 0.13)
                : u * u + v * v + (kind === 'vine' ? (h - 0.45) ** 2 * 1.8 : 0);
            if (profile < edge) data[(y * dims[2] + z) * dims[0] + x] = 1;
          }
      const faces = voxelFaces({
        dims,
        origin,
        data,
        step: size.map((length, axis) => length / dims[axis]),
        shade([x, y, z], axis, sign) {
          if (axis === 1 && sign < 0) return 1;
          const patch =
            (Math.floor((x + (style % 2)) / 2) * 3 + Math.floor(z / 2) * 5 + y + style) % 11;
          if (kind === 'puddle') return axis !== 1 ? 2 : patch === 3 ? 6 : patch < 3 ? 3 : 4;
          if (axis === 1) return patch === 3 ? 7 : patch < 4 ? 5 : 6;
          return patch === 7 ? 8 : patch < 3 ? 2 : patch < 7 ? 3 : 4;
        },
      });
      // Rasterised corners still fit the original circular prop reservation.
      if (kind !== 'vine') {
        let radius = 0;
        for (const face of faces)
          for (let i = 0; i < face.points.length; i += 3)
            radius = Math.max(radius, Math.hypot(face.points[i], face.points[i + 2]));
        for (const face of faces)
          for (let i = 0; i < face.points.length; i += 3) {
            face.points[i] /= Math.max(1, radius);
            face.points[i + 2] /= Math.max(1, radius);
          }
      }
      forms.set(`${kind}:${style}`, faces);
    }
  atlas = packFoliageAtlas(forms);
  return atlas;
}

export function dressingGeometry(kind, seed = 0, variant = 0) {
  return crownGeometry(dressingAtlas().crowns.get(`${kind}:${((seed >>> 0) + variant * 4) % 12}`));
}

// Indexed, crossed cutout blades retain depth from every camera direction.
export function appendPlant(
  points,
  uvs,
  indices,
  { x = 0, y = 0, z = 0, height, width, lean = 0, angle = 0, style = 0 },
) {
  for (let plane = 0; plane < 2; plane++) {
    const a = angle + (plane * Math.PI) / 2;
    const dx = (Math.cos(a) * width) / 2,
      dz = (Math.sin(a) * width) / 2;
    const start = points.length / 3;
    points.push(
      x - dx,
      y,
      z - dz,
      x + dx,
      y,
      z + dz,
      x + dx + lean,
      y + height,
      z + dz,
      x - dx + lean,
      y + height,
      z - dz,
    );
    const u = (style % 4) / 4;
    uvs.push(u, 0, u + 0.25, 0, u + 0.25, 1, u, 1);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

export function plantGeometry(points, uvs, indices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function groundGeometry(points, repeat = 0.4) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const uvs = new Float32Array((points.length / 3) * 2);
  for (let i = 0; i < points.length / 3; i++) {
    uvs[i * 2] = points[i * 3] / repeat;
    uvs[i * 2 + 1] = points[i * 3 + 2] / repeat;
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(Array.from({ length: points.length / 3 }, (_, i) => i));
  geometry.computeVertexNormals();
  return geometry;
}

export function dressingPattern(kind) {
  if (['rock', 'rockMid', 'puddle', 'vine'].includes(kind)) return dressingAtlas();
  const plant = ['grass', 'marshGrass', 'reeds', 'grain'].includes(kind);
  const width = plant ? 64 : 16,
    height = plant ? 32 : 16;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x % 16,
        style = Math.floor(x / 16);
      const patch = (Math.floor(x / 2) * 3 + Math.floor(y / 3) * 5) % 13;
      let shade = patch < 3 ? 3 : patch === 9 ? 6 : 4;
      if (plant) {
        shade = 0;
        if (kind === 'grain') {
          if (u >= 7 && u <= 8 && y < 30) shade = y < 20 ? 2 : 5;
          if (y >= 20 && y < 29 && (Math.floor(y / 2) + style) % 2 === 0 && u >= 4 && u <= 11)
            shade = u < 8 ? 4 : 6;
          if (y >= 29 && u >= 7 && u <= 8) shade = 7;
        } else {
          for (let blade = 0; blade < 3; blade++) {
            const top = [23 + style, 31 - style, 19 + style * 2][blade];
            const center = 7 + (blade - 1) * Math.floor(y / (blade === 1 ? 10 : 5));
            if (y <= top && Math.abs(u - center) <= (y < top - 4 ? 1 : 0))
              shade = u <= center ? 3 : y > top / 2 ? 6 : 4;
          }
        }
      } else if (kind === 'grainGround') {
        shade = x % 4 === 0 ? 2 : patch < 3 ? 3 : patch === 9 ? 6 : 4;
      } else if (kind === 'soil') {
        shade = y % 5 === 0 ? 2 : patch === 9 ? 5 : 4;
      } else if (kind === 'timber' || kind === 'reedStem') {
        shade = x % 5 === 0 ? 2 : (x + Math.floor(y / 6)) % 5 === 2 ? 5 : 4;
      } else if (kind === 'grape' || kind === 'reedHead') {
        shade = x % 5 < 2 && y % 5 < 2 ? 6 : x % 5 === 4 || y % 5 === 4 ? 2 : 4;
      }
      indices[y * width + x] = shade;
    }
  return { width, height, indices, cutout: plant };
}
