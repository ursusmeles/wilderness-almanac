import * as THREE from 'three';
import { createColorScale, hexToOklch } from '../palette.js';

// Three small ramps per piece: dyed cloth, carved stone/metal, dark recesses.
export function createPartyPieceMaterials(style, accent) {
  const owned = [];
  const material = (hex, kind) => {
    const [L, C] = hexToOklch(hex);
    const scale = createColorScale([hex], { preserveChroma: true });
    const colors = [-0.1, -0.045, -0.018, 0, 0.025, 0.06].map((shift, i) =>
      new THREE.Color(
        scale(
          0,
          Math.max(0.12, Math.min(0.95, L + shift)),
          1,
          0,
          C > 0.03 ? [5, 3, 0, 0, -3, -6][i] : 0,
        ),
      ).getHex(),
    );
    const data = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const patch = ((x >> 1) * 17 + (y >> 1) * 29 + ((x >> 2) ^ (y >> 2)) * 7) % 23;
        let shade = patch < 4 ? 2 : patch > 19 ? 4 : 3;
        if (kind === 'cloth' && (x * 13 + y * 7) % 41 === 0) shade = 5;
        if (kind === 'carved' && (x * 7 + y * 11) % 61 === 0) shade = 1;
        const color = colors[shade],
          i = (y * 16 + x) * 4;
        data[i] = (color >>> 16) & 255;
        data[i + 1] = (color >>> 8) & 255;
        data[i + 2] = color & 255;
        data[i + 3] = 255;
      }
    const texture = new THREE.DataTexture(data, 16, 16);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const result = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.93,
      flatShading: true,
    });
    owned.push(result);
    return result;
  };
  return {
    accent: material(accent, 'cloth'),
    pale: material(['#ead7ae', '#c5d0d4', '#c0c5b6'][style], 'carved'),
    dark: material('#252729', 'dark'),
    dispose() {
      for (const material of owned) {
        material.map.dispose();
        material.dispose();
      }
    },
  };
}
