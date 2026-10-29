import * as THREE from 'three';
import { createColorScale, hexToOklch } from '../palette.js';

const SIZE = 32;
const seed = '#83917c';
const [, seedC, seedH] = hexToOklch(seed);
const scale = createColorScale([seed], { preserveChroma: true });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (x, y) => {
  let n = Math.imul(x + 127, 374761393) ^ Math.imul(y + 593, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
};

function pattern(kind) {
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const patch = hash(x >> 1, y >> 1) % 23;
      pixels[y * SIZE + x] = patch < 4 ? 2 : patch > 19 ? 4 : 3;
      if (hash(x, y) % 101 === 0) pixels[y * SIZE + x] = 5;
    }
  const put = (x, y, shade) => (pixels[(y % SIZE) * SIZE + (x % SIZE)] = shade);
  if (kind === 'water') {
    // A few broken, stepped wavelets; broad depth comes from vertex colour.
    for (const [x, y] of [
      [3, 5],
      [20, 14],
      [9, 25],
    ]) {
      put(x, y, 6);
      put(x + 1, y, 6);
      put(x + 2, y + 1, 5);
      put(x + 3, y + 1, 5);
    }
  } else if (kind === 'foliage') {
    // Sparse fallen leaves/low foliage, rather than another layer of grass.
    for (const [x, y] of [
      [4, 7],
      [23, 4],
      [15, 19],
      [28, 26],
    ]) {
      put(x, y, 7);
      put(x + 1, y, 7);
      put(x + 1, y + 1, 6);
      put(x, y + 1, 1);
    }
  }
  return pixels;
}

// Shared, opaque surfaces: no extra scatter meshes or transparent water pass.
export function createPixelTerrainMaterials({ getColor, shadeColor, getHiddenColor }) {
  const variants = new Map();
  const patterns = new Map();
  function repaint(entry) {
    const { kind, temperature, light, state, texture } = entry;
    const edge = ['side', 'bevel', 'waterDeep'].includes(kind);
    const source = edge ? kind : kind === 'water' ? 'water' : light ? 'groundLight' : 'ground';
    const [L, C, h] = hexToOklch(`#${getColor(source, temperature).getHexString()}`);
    const offsets = [-0.035, -0.021, -0.01, 0, 0.012, 0.025, 0.065, -0.015];
    const colors = offsets.map((d, i) => {
      const hex = scale(
        0,
        clamp(L + d * (edge ? 0.45 : 1), 0.12, 0.94),
        C / seedC,
        0,
        ((h - seedH) * 180) / Math.PI + (i === 7 ? 5 : 0),
      );
      const color = new THREE.Color(hex);
      if (kind === 'foliage' && i >= 6) {
        color.lerp(getColor('grass', temperature), 0.24);
      }
      shadeColor(color);
      if (state === 'unvisited') {
        const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        color.setRGB(gray, gray, gray);
      } else if (state !== 'visited') color.copy(getHiddenColor(kind));
      return color.getHex();
    });
    const data = texture.image.data;
    for (let i = 0; i < entry.pixels.length; i++) {
      const color = colors[entry.pixels[i]];
      data[i * 4] = (color >>> 16) & 255;
      data[i * 4 + 1] = (color >>> 8) & 255;
      data[i * 4 + 2] = color & 255;
      data[i * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  }
  return {
    material(kind, temperature = 0, light = false, state = 'visited') {
      const key = `${kind}:${temperature}:${light}:${state}`;
      if (!variants.has(key)) {
        if (!patterns.has(kind)) patterns.set(kind, pattern(kind));
        const texture = new THREE.DataTexture(new Uint8Array(SIZE * SIZE * 4), SIZE, SIZE);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = false;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1,
          flatShading: ['side', 'bevel', 'waterDeep'].includes(kind),
          metalness: 0,
          vertexColors: kind === 'water' && ['visited', 'unvisited'].includes(state),
        });
        material.userData.pixelTerrain = { kind, temperature, light };
        const entry = {
          kind,
          temperature,
          light,
          state,
          material,
          texture,
          pixels: patterns.get(kind),
        };
        repaint(entry);
        variants.set(key, entry);
      }
      return variants.get(key).material;
    },
    repaint() {
      for (const entry of variants.values()) repaint(entry);
    },
    dispose() {
      for (const { material, texture } of variants.values()) {
        material.dispose();
        texture.dispose();
      }
      variants.clear();
      patterns.clear();
    },
  };
}
