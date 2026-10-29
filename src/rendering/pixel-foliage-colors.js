import { createColorScale, hexToOklch } from '../palette.js';

export const EVERGREEN_SPECIES = ['fir', 'spruce', 'pine'];
export const FOLIAGE_TONE_COUNT = 8;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const delta = (target, source) => ((target - source + 540) % 360) - 180;

// Species identity leads; map colours provide a restrained ambient tint.
const profiles = {
  fir: {
    seed: '#267858',
    bark: [0.31, 0.035, 290],
    foliage: [
      [0.23, 0.055, 255],
      [0.34, 0.085, 190],
      [0.44, 0.115, 165],
      [0.52, 0.12, 155],
      [0.6, 0.135, 145],
      [0.65, 0.09, 180],
      [0.73, 0.14, 124],
      [0.82, 0.08, 112],
    ],
  },
  spruce: {
    seed: '#3b8393',
    bark: [0.34, 0.04, 65],
    foliage: [
      [0.22, 0.045, 265],
      [0.34, 0.065, 230],
      [0.44, 0.085, 205],
      [0.53, 0.105, 190],
      [0.62, 0.08, 180],
      [0.68, 0.06, 215],
      [0.76, 0.08, 160],
      [0.84, 0.035, 195],
    ],
  },
  pine: {
    seed: '#708438',
    bark: [0.39, 0.075, 48],
    foliage: [
      [0.24, 0.04, 270],
      [0.34, 0.065, 200],
      [0.44, 0.075, 165],
      [0.53, 0.1, 136],
      [0.61, 0.12, 115],
      [0.65, 0.08, 163],
      [0.74, 0.13, 100],
      [0.83, 0.075, 90],
    ],
  },
};
for (const profile of Object.values(profiles)) {
  profile.coordinates = hexToOklch(profile.seed);
  profile.scale = createColorScale([profile.seed], { preserveChroma: true });
}

function swatch(profile, [lightness, chroma, hue], mapHex, temperature, tone, influence) {
  const [mapL, mapC, mapH] = hexToOklch(mapHex);
  const [, seedC, seedH] = profile.coordinates;
  const tint = clamp(delta((mapH * 180) / Math.PI, hue) * influence, -22, 22);
  return profile.scale(
    0,
    lightness + clamp((mapL - 0.68) * 0.12, -0.025, 0.025) + tone * 0.012,
    Math.max(0.015, chroma + clamp((mapC - 0.15) * 0.12, -0.015, 0.015)) / seedC,
    temperature,
    delta(hue, (seedH * 180) / Math.PI) + tint + tone * 2,
  );
}

export function pixelFoliageRamp(species, mapHex, temperature = 0, tone = 0) {
  const profile = profiles[species];
  return profile.foliage.map((shade) => swatch(profile, shade, mapHex, temperature, tone, 0.22));
}

export function pixelBarkColor(species, mapHex, temperature = 0, tone = 0) {
  const profile = profiles[species];
  const [L, C, H] = profile.bark;
  const shade =
    species === 'pine'
      ? [L + tone * 0.075, C + Math.max(0, tone) * 0.02, H - tone * 7]
      : profile.bark;
  return swatch(profile, shade, mapHex, temperature, tone, 0.1);
}
