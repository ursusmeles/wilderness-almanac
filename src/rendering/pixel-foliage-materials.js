import * as THREE from 'three';
import { evergreenAtlas } from './pixel-evergreens.js';
import { deciduousAtlas } from './pixel-deciduous.js';
import {
  EVERGREEN_SPECIES,
  DECIDUOUS_SPECIES,
  pixelFoliageRamp,
  pixelBarkColor,
} from './pixel-foliage-colors.js';
import { installTreeSway } from './ambient-motion.js';

// All shape variants share an atlas; only palette/temperature/fog need variants.
export function createPixelFoliageMaterials({ getColor, shadeColor, getHiddenColor, time, wind }) {
  const variants = new Map();
  const families = {
    evergreen: { atlas: evergreenAtlas, species: EVERGREEN_SPECIES },
    deciduous: { atlas: deciduousAtlas, species: DECIDUOUS_SPECIES },
  };
  function shaded(hex, state) {
    const color = shadeColor(new THREE.Color(hex));
    if (state === 'unvisited') {
      const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      color.setRGB(gray, gray, gray);
    } else if (state !== 'visited') color.copy(getHiddenColor());
    return color;
  }
  function repaint(entry) {
    const { material, texture, temperature, tone, state, species, family } = entry;
    const mapHex = `#${getColor('leaf', temperature).getHexString()}`;
    if (species) {
      const color = shaded(pixelBarkColor(species, mapHex, temperature, tone), state);
      if (!texture) material.color.copy(color);
      else {
        const pixels = texture.image.data;
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 8; x++) {
            const scar = (y === 3 && x < 3) || (y === 8 && x > 2) || (y === 13 && x > 0 && x < 5);
            const factor =
              state !== 'visited' && state !== 'unvisited'
                ? 1
                : scar
                  ? 0.045
                  : (x + y * 3) % 13 === 0
                    ? 0.6
                    : 1;
            const hex = color.clone().multiplyScalar(factor).getHex();
            const i = (y * 8 + x) * 4;
            pixels[i] = (hex >>> 16) & 255;
            pixels[i + 1] = (hex >>> 8) & 255;
            pixels[i + 2] = hex & 255;
            pixels[i + 3] = 255;
          }
        texture.needsUpdate = true;
      }
      return;
    }
    const colors = families[family].species.flatMap((species) =>
      pixelFoliageRamp(species, mapHex, temperature, tone).map((hex) =>
        shaded(hex, state).getHex(),
      ),
    );
    const { indices } = families[family].atlas();
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
    material(temperature = 0, tone = 0, state = 'visited', family = 'evergreen') {
      const key = `${family}:${temperature}:${tone}:${state}`;
      if (!variants.has(key)) {
        const { width, height } = families[family].atlas();
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
        material.userData.pixelFoliage = { temperature, tone, family };
        installTreeSway(material, time, wind);
        const entry = { material, texture, temperature, tone, state, family };
        repaint(entry);
        variants.set(key, entry);
      }
      return variants.get(key).material;
    },
    barkMaterial(species, temperature = 0, tone = 0, state = 'visited') {
      const key = `bark:${species}:${temperature}:${tone}:${state}`;
      if (!variants.has(key)) {
        const material = new THREE.MeshStandardMaterial({
          roughness: 1,
          metalness: 0,
          flatShading: true,
        });
        let texture;
        if (species === 'birch' && tone >= 0) {
          texture = new THREE.DataTexture(new Uint8Array(8 * 16 * 4), 8, 16);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = texture.magFilter = THREE.NearestFilter;
          texture.generateMipmaps = false;
          material.map = texture;
        }
        material.userData.pixelBark = { species, temperature, tone };
        installTreeSway(material, time, wind);
        const entry = { material, texture, species, temperature, tone, state };
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
        texture?.dispose();
      }
      variants.clear();
    },
  };
}
