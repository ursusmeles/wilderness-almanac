import * as THREE from 'three';
import { createColorScale, hexToOklch } from '../palette.js';

// Role identity stays stable; the map supplies a smaller ambient colour influence.
const profiles = {
  wall: ['plaster', 0.87, 0.012, 85, 0.22],
  roof: ['tiles', 0.5, 0.075, 145, 0.3],
  roofLight: ['tiles', 0.61, 0.065, 145, 0.3],
  straw: ['thatch', 0.75, 0.09, 85, 0.25],
  strawDark: ['thatch', 0.61, 0.07, 75, 0.25],
  trunk: ['wood', 0.3, 0.035, 60, 0.2],
  door: ['wood', 0.23, 0.025, 65, 0.18],
  bridgeWood: ['wood', 0.53, 0.06, 65, 0.25],
  bridgeLight: ['wood', 0.66, 0.065, 75, 0.25],
  bridgeDark: ['wood', 0.29, 0.035, 65, 0.2],
  banner: ['cloth', 0.66, 0.18, 25, 0.08],
  rope: ['cloth', 0.68, 0.04, 85, 0.2],
  rock: ['masonry', 0.61, 0.025, 255, 0.22],
  rockMid: ['masonry', 0.48, 0.025, 260, 0.22],
  rockLight: ['masonry', 0.77, 0.018, 240, 0.22],
  ridge: ['stone', 0.46, 0.035, 65, 1],
  ridgeLight: ['stone', 0.55, 0.03, 80, 1],
  ridgeDark: ['stone', 0.31, 0.025, 65, 1],
  riverGround: ['bank', 0.39, 0.04, 65, 0.9],
  riverCliff: ['bank', 0.3, 0.035, 65, 0.6],
  riverWater: ['water', 0.48, 0.08, 210, 1],
  road: ['road', 0.44, 0.04, 65, 0.9],
  waterEdge: ['crystal', 0.6, 0.12, 265, 0.3],
  fruit: ['crystal', 0.6, 0.12, 25, 0.3],
};
const delta = (target, source) => ((target - source + 540) % 360) - 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seed = '#83917c',
  [, seedC, seedH] = hexToOklch(seed),
  scale = createColorScale([seed], { preserveChroma: true });

function pattern(type) {
  const indices = new Uint8Array(16 * 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const cluster = (Math.floor(x / 2) * 3 + Math.floor(y / 2) * 5) % 13;
      let shade = cluster < 3 ? 3 : cluster === 9 ? 5 : 4;
      if (type === 'masonry') {
        const u = (x + Math.floor(y / 4) * 4) % 8;
        shade = y % 4 === 0 || u === 0 ? 2 : cluster === 9 ? 6 : cluster < 3 ? 3 : 4;
      } else if (type === 'tiles') {
        const u = (x + Math.floor(y / 4) * 2) % 4;
        shade = y % 4 === 0 ? 2 : u === 0 ? 3 : cluster === 9 ? 6 : 4;
      } else if (type === 'wood')
        shade = x % 5 === 0 ? 2 : (x + Math.floor(y / 5)) % 7 === 1 ? 5 : cluster < 3 ? 3 : 4;
      else if (type === 'thatch') shade = x % 3 === 0 ? 3 : y % 5 === 0 ? 5 : cluster === 9 ? 6 : 4;
      else if (type === 'stone') {
        const patch = ((x >> 1) * 17 + (y >> 1) * 29 + ((x >> 2) ^ (y >> 2)) * 13) % 23;
        shade = patch < 3 ? 2 : patch < 8 ? 3 : patch > 19 ? 5 : 4;
        if ((x * 31 + y * 47) % 101 === 0) shade = 6;
      } else if (type === 'bank' || type === 'road')
        shade = cluster === 9 ? 5 : cluster < 3 ? 3 : 4;
      else if (type === 'water') shade = y % 8 === 0 && x % 8 < 3 ? 6 : cluster < 3 ? 3 : 4;
      else if (type === 'crystal') shade = (x + y) % 9 < 2 ? 6 : cluster < 3 ? 2 : 4;
      indices[y * 16 + x] = shade;
    }
  return indices;
}

function ramp(role, mapHex, tone, temperature) {
  const [, baseL, baseC, nativeH, influence] = profiles[role];
  const [mapL, mapC, mapH] = hexToOklch(mapHex),
    hue = (mapH * 180) / Math.PI;
  const roof = role === 'roof' || role === 'roofLight';
  const H = roof ? [35, 65, 145, 245, 45][clamp(tone + 2, 0, 4)] : nativeH;
  const mountain = role.startsWith('ridge');
  const terrain = mountain || ['road', 'riverGround', 'riverCliff', 'riverWater'].includes(role);
  const L = terrain ? mapL : baseL + clamp((mapL - baseL) * 0.25, -0.035, 0.035);
  const C =
    mountain || role === 'riverWater' ? mapC : baseC + clamp((mapC - baseC) * 0.2, -0.01, 0.015);
  const h = H + delta(hue, H) * influence;
  const quiet = mountain || ['bank', 'road', 'water'].includes(profiles[role][0]);
  const offsets = quiet
    ? [-0.045, -0.026, -0.009, 0, 0.013, 0.026, 0.04, -0.016]
    : [-0.12, -0.065, -0.025, 0, 0.025, 0.055, 0.085, -0.035];
  return offsets.map((d, i) =>
    scale(
      0,
      clamp(L + d, 0.12, 0.93),
      Math.max(0.008, C * [0.6, 0.75, 1, 1, 1.1, 0.85, 0.7, 0.8][i]) / seedC,
      temperature,
      delta(h + [-10, 8, 5, 0, -5, -10, -15, 16][i], (seedH * 180) / Math.PI),
    ),
  );
}

export function createPixelModelMaterials({ getColor, shadeColor, getHiddenColor }) {
  const variants = new Map(),
    patterns = new Map();
  function repaint({ role, temperature, tone, state, texture, indices }) {
    const source = role === 'riverWater' ? 'water' : role;
    const hex = `#${getColor(source, temperature, tone).getHexString()}`;
    const colors = ramp(role, hex, tone, temperature).map((hex) => {
      const color = shadeColor(new THREE.Color(hex));
      if (state === 'unvisited') {
        const v = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        color.setRGB(v, v, v);
      } else if (state !== 'visited') color.copy(getHiddenColor());
      return color.getHex();
    });
    const data = texture.image.data;
    for (let i = 0; i < indices.length; i++) {
      const color = colors[indices[i] - 1];
      data[i * 4] = (color >>> 16) & 255;
      data[i * 4 + 1] = (color >>> 8) & 255;
      data[i * 4 + 2] = color & 255;
      data[i * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  }
  return {
    material(role, temperature = 0, tone = 0, state = 'visited') {
      const key = `${role}:${temperature}:${tone}:${state}`;
      if (!variants.has(key)) {
        const type = profiles[role][0];
        if (!patterns.has(type)) patterns.set(type, pattern(type));
        const texture = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 1,
          metalness: 0,
          flatShading: !['riverGround', 'riverCliff'].includes(role),
          side: ['roof', 'roofLight', 'straw', 'rock', 'bridgeDark'].includes(role)
            ? THREE.DoubleSide
            : THREE.FrontSide,
        });
        material.userData.pixelModel = { role, temperature, tone };
        const entry = {
          material,
          texture,
          indices: patterns.get(type),
          role,
          temperature,
          tone,
          state,
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
