import * as THREE from 'three';
import { evergreenAtlas, EVERGREEN_SHADES } from './pixel-evergreens.js';
import { installTreeSway } from './ambient-motion.js';

// All shape variants share an atlas; only palette/temperature/fog need variants.
export function createPixelFoliageMaterials({ getColor, getHiddenColor, time, wind }) {
  const variants = new Map();
  function repaint(entry) {
    const { texture, temperature, tone, state } = entry;
    const colors = EVERGREEN_SHADES.map(([role, offset]) => {
      const color = getColor(role, temperature, tone + offset);
      if (state === 'unvisited') {
        const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        color.setRGB(gray, gray, gray);
      } else if (state !== 'visited') color.copy(getHiddenColor());
      return color.getHex();
    });
    const { indices } = evergreenAtlas();
    const pixels = texture.image.data;
    for (let i = 0; i < indices.length; i++) {
      const hex = colors[Math.max(0, indices[i] - 1)];
      pixels[i * 4] = (hex >>> 16) & 255;
      pixels[i * 4 + 1] = (hex >>> 8) & 255;
      pixels[i * 4 + 2] = hex & 255;
      pixels[i * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  }
  return {
    material(temperature = 0, tone = 0, state = 'visited') {
      const key = `${temperature}:${tone}:${state}`;
      if (!variants.has(key)) {
        const { width, height } = evergreenAtlas();
        const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1,
          metalness: 0,
          flatShading: true,
        });
        material.userData.pixelFoliage = { temperature, tone };
        installTreeSway(material, time, wind);
        const entry = { material, texture, temperature, tone, state };
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
    },
  };
}
