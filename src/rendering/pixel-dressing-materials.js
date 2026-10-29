import * as THREE from 'three';
import { createColorScale, hexToOklch } from '../palette.js';
import { installTreeSway } from './ambient-motion.js';
import { pixelFoliageRamp } from './pixel-foliage-colors.js';
import { dressingPattern } from './pixel-dressing-geometry.js';

const profiles = {
  grass: ['grass', 0.55, 0.1, 135, 0.65],
  marshGrass: ['reeds', 0.51, 0.08, 160, 0.4],
  reeds: ['reeds', 0.54, 0.09, 155, 0.4],
  reedStem: ['reeds', 0.48, 0.07, 145, 0.4],
  reedHead: ['reedHead', 0.38, 0.055, 55, 0.15],
  rock: ['rock', 0.59, 0.025, 250, 0.18],
  rockMid: ['rockMid', 0.51, 0.03, 265, 0.18],
  roadStone: ['roadStone', 0.46, 0.025, 65, 1],
  puddle: ['water', 0.48, 0.07, 200, 1],
  grain: ['grain', 0.72, 0.12, 85, 0.15],
  grainGround: ['grainGround', 0.59, 0.09, 80, 0.15],
  soil: ['soil', 0.32, 0.035, 65, 0.3],
  timber: ['trunk', 0.34, 0.04, 65, 0.15],
  grape: ['grape', 0.4, 0.12, 305, 0.1],
  vine: ['leaf'],
};
const moving = new Set(['marshGrass', 'reeds', 'reedStem', 'reedHead', 'grain']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const delta = (target, source) => ((target - source + 540) % 360) - 180;
const seed = '#7d8b69';
const [, seedC, seedH] = hexToOklch(seed);
const scale = createColorScale([seed], { preserveChroma: true });

function ramp(kind, mapHex, temperature) {
  if (kind === 'vine') return pixelFoliageRamp('orchard', mapHex, temperature);
  const [, baseL, baseC, baseH, influence] = profiles[kind];
  const [mapL, mapC, mapH] = hexToOklch(mapHex);
  const hue = baseH + delta((mapH * 180) / Math.PI, baseH) * influence;
  const water = kind === 'puddle';
  const terrain = water || kind === 'roadStone';
  const L = terrain ? mapL : baseL + clamp((mapL - baseL) * 0.15, -0.025, 0.025);
  const C = terrain ? mapC : baseC;
  const shades = water
    ? [-0.09, -0.05, -0.018, 0, 0.015, 0.035, 0.06, -0.025]
    : [-0.19, -0.105, -0.045, 0, 0.045, 0.09, 0.135, -0.02];
  return shades.map((offset, index) => {
    const mineral = ['rock', 'rockMid'].includes(kind) && index === 7;
    const H = mineral ? 130 : hue + [-15, 8, 12, 0, -5, -12, -18, 25][index];
    const chroma = mineral ? 0.04 : C * [0.5, 0.75, 0.85, 1, 1.05, 0.85, 0.65, 0.8][index];
    return scale(
      0,
      clamp(L + offset, 0.13, 0.88),
      chroma / seedC,
      temperature,
      delta(H, (seedH * 180) / Math.PI),
    );
  });
}

// Tiny shared colour-index textures; repaint in place for palette, fog and night.
export function createPixelDressingMaterials({ getColor, shadeColor, getHiddenColor, time, wind }) {
  const variants = new Map(),
    patterns = new Map();
  function repaint({ kind, temperature, state, texture, pattern }) {
    const mapHex = `#${getColor(profiles[kind][0], temperature).getHexString()}`;
    const colors = ramp(kind, mapHex, temperature).map((hex) => {
      const color = shadeColor(new THREE.Color(hex));
      if (state === 'unvisited') {
        const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        color.setRGB(gray, gray, gray);
      } else if (state !== 'visited') color.copy(getHiddenColor());
      return color.getHex();
    });
    const pixels = texture.image.data;
    for (let i = 0; i < pattern.indices.length; i++) {
      const index = pattern.indices[i],
        hex = colors[Math.max(0, index - 1)];
      pixels[i * 4] = (hex >>> 16) & 255;
      pixels[i * 4 + 1] = (hex >>> 8) & 255;
      pixels[i * 4 + 2] = hex & 255;
      pixels[i * 4 + 3] = pattern.cutout && !index ? 0 : 255;
    }
    texture.needsUpdate = true;
  }
  return {
    material(kind, temperature = 0, state = 'visited') {
      const key = `${kind}:${temperature}:${state}`;
      if (!variants.has(key)) {
        if (!patterns.has(kind)) patterns.set(kind, dressingPattern(kind));
        const pattern = patterns.get(kind);
        const texture = new THREE.DataTexture(
          new Uint8Array(pattern.width * pattern.height * 4),
          pattern.width,
          pattern.height,
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.generateMipmaps = false;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1,
          metalness: 0,
          flatShading: true,
          alphaTest: pattern.cutout ? 0.5 : 0,
          side: pattern.cutout ? THREE.DoubleSide : THREE.FrontSide,
        });
        material.userData.pixelDressing = { kind, temperature };
        if (moving.has(kind)) installTreeSway(material, time, wind);
        const entry = { material, texture, pattern, kind, temperature, state };
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
