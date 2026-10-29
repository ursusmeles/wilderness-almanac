import * as THREE from 'three';
import { createColorScale, hexToOklch } from '../palette.js';

const smooth = (v) => v * v * (3 - 2 * v);
const hash = (x, y) => {
  let n = Math.imul(x + 71, 374761393) ^ Math.imul(y + 193, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
function noise(x, y, period) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const at = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period);
  const tx = smooth(x - ix),
    ty = smooth(y - iy);
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(mix(at(ix, iy), at(ix + 1, iy), tx), mix(at(ix, iy + 1), at(ix + 1, iy + 1), tx), ty);
}
function cloud(x, y) {
  return (
    noise(x * 4, y * 4, 4) * 0.55 +
    noise(x * 8, y * 8, 8) * 0.28 +
    noise(x * 16, y * 16, 16) * 0.12 +
    noise(x * 32, y * 32, 32) * 0.05
  );
}
function marble(x, y, size, dark) {
  const u = x / size,
    v = y / size;
  const smoke = cloud(u, v),
    flow = noise(u * 2, v * 2, 2),
    warp = noise(u * 4 + 1.37, v * 4 + 2.61, 4);
  const vein = Math.abs(Math.sin(Math.PI * 2 * (u + v + flow * 1.1 + warp * 0.24)));
  const branch = Math.abs(Math.sin(Math.PI * 2 * (u * 2 - v + flow * 0.65)));
  const grain = hash(x + 97, y + 31);
  let shade = Math.max(4, Math.min(10, Math.floor(5 + smoke * 5 + (grain - 0.5) * 0.35)));
  if (vein < 0.075 || (branch < 0.035 && smoke > 0.6)) shade = dark ? 9 : 1;
  else if (vein < 0.18) shade = dark ? 7 : 3;
  else if (vein < 0.3) shade = dark ? 6 : 4;
  if (grain > 0.985) shade = Math.min(11, shade + 1);
  return shade;
}

// Finely veined marble and dyed cloth, still three lit ramps/meshes per piece.
export function createPartyPieceMaterials(style, accent) {
  const owned = [];
  const material = (hex, kind) => {
    const [L, C] = hexToOklch(hex);
    const scale = createColorScale([hex], { preserveChroma: true });
    const stone = kind !== 'cloth',
      dark = kind === 'dark';
    const size = stone ? 64 : 32;
    const offsets = stone
      ? [-0.2, -0.15, -0.11, -0.07, -0.04, -0.015, 0, 0.02, 0.04, 0.06, 0.085, 0.11]
      : [-0.1, -0.07, -0.045, -0.025, -0.012, 0, 0.012, 0.025, 0.04, 0.055, 0.07, 0.085];
    const colors = offsets.map((shift, i) =>
      new THREE.Color(
        scale(
          0,
          Math.max(0.12, Math.min(0.96, L + shift * (dark ? 0.55 : 1))),
          stone ? (i < 4 ? 0.55 : 0.85 + (i % 3) * 0.12) : 1,
          0,
          C > 0.03 ? (i < 4 ? -8 : ((i % 3) - 1) * 5) : 0,
        ),
      ).getHex(),
    );
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const patch = ((x >> 1) * 17 + (y >> 1) * 29) % 23;
        const shade = stone
          ? marble(x, y, size, dark)
          : (x * 13 + y * 7) % 41 === 0
            ? 9
            : patch < 4
              ? 4
              : patch > 19
                ? 7
                : 5;
        const color = colors[shade],
          i = (y * size + x) * 4;
        data[i] = (color >>> 16) & 255;
        data[i + 1] = (color >>> 8) & 255;
        data[i + 2] = color & 255;
        data[i + 3] = 255;
      }
    const texture = new THREE.DataTexture(data, size, size);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const result = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: stone ? 0.55 : 0.93,
      flatShading: true,
    });
    owned.push(result);
    return result;
  };
  return {
    accent: material(accent, 'cloth'),
    pale: material(['#ead7ae', '#c5d0d4', '#c0c5b6'][style], 'marble'),
    dark: material('#252729', 'dark'),
    dispose() {
      for (const material of owned) {
        material.map.dispose();
        material.dispose();
      }
    },
  };
}
