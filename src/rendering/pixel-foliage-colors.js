import { createColorScale, hexToOklch } from '../palette.js';

export const EVERGREEN_SPECIES = ['fir', 'spruce', 'pine'];
export const DECIDUOUS_SPECIES = ['oak', 'beech', 'ash', 'birch', 'orchard'];
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
  oak: {
    seed: '#68853e',
    bark: [0.31, 0.045, 55],
    foliage: [
      [0.23, 0.04, 280],
      [0.35, 0.07, 185],
      [0.43, 0.1, 160],
      [0.52, 0.115, 150],
      [0.6, 0.13, 134],
      [0.62, 0.08, 175],
      [0.72, 0.12, 112],
      [0.8, 0.07, 95],
    ],
  },
  beech: {
    seed: '#719f46',
    bark: [0.44, 0.02, 90],
    foliage: [
      [0.25, 0.04, 265],
      [0.38, 0.07, 185],
      [0.49, 0.11, 150],
      [0.59, 0.14, 132],
      [0.67, 0.16, 118],
      [0.69, 0.09, 160],
      [0.79, 0.13, 102],
      [0.87, 0.065, 90],
    ],
  },
  ash: {
    seed: '#819666',
    bark: [0.37, 0.025, 85],
    foliage: [
      [0.26, 0.035, 270],
      [0.39, 0.055, 195],
      [0.5, 0.09, 150],
      [0.59, 0.095, 140],
      [0.66, 0.1, 125],
      [0.67, 0.06, 175],
      [0.77, 0.1, 105],
      [0.86, 0.045, 95],
    ],
  },
  birch: {
    seed: '#8cad4c',
    bark: [0.82, 0.012, 85],
    foliage: [
      [0.25, 0.035, 270],
      [0.38, 0.08, 185],
      [0.5, 0.115, 155],
      [0.62, 0.15, 125],
      [0.69, 0.15, 112],
      [0.71, 0.08, 165],
      [0.8, 0.12, 96],
      [0.88, 0.06, 85],
    ],
  },
  orchard: {
    seed: '#649747',
    bark: [0.34, 0.055, 55],
    foliage: [
      [0.24, 0.04, 265],
      [0.37, 0.065, 190],
      [0.48, 0.105, 155],
      [0.58, 0.13, 140],
      [0.66, 0.14, 120],
      [0.68, 0.085, 165],
      [0.77, 0.13, 105],
      [0.86, 0.055, 90],
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
  if (!DECIDUOUS_SPECIES.includes(species))
    return profile.foliage.map((shade) => swatch(profile, shade, mapHex, temperature, tone, 0.22));
  const mapHue = ((hexToOklch(mapHex)[2] * 180) / Math.PI + 360) % 360;
  const edge =
    mapHue <= 95 ? 1 : mapHue < 130 ? (130 - mapHue) / 35 : mapHue > 330 ? (mapHue - 330) / 30 : 0;
  const warmth = edge * edge * (3 - 2 * edge);
  const season = warmth * clamp(0.82 + tone * 0.16, 0.6, 1);
  const autumn = {
    oak: [270, 25, 25, 38, 55, 130, 75, 88],
    beech: [275, 20, 30, 48, 62, 110, 78, 92],
    ash: [270, 45, 65, 72, 88, 135, 92, 100],
    birch: [270, 70, 85, 96, 102, 130, 100, 105],
    orchard: [270, 35, 40, 60, 80, 125, 88, 98],
  };
  return profile.foliage.map(([L, C, H], index) =>
    swatch(
      profile,
      [
        L + (index > 3 ? 0.012 : 0) * season,
        Math.min(0.18, C * (1 + (index > 1 ? 0.25 : 0.1) * season)),
        H + delta(autumn[species][index], H) * season,
      ],
      mapHex,
      temperature,
      tone,
      0.22,
    ),
  );
}

export function pixelBarkColor(species, mapHex, temperature = 0, tone = 0) {
  const profile = profiles[species];
  if (species === 'birch' && tone < 0)
    return swatch(profile, [0.29, 0.025, 65], mapHex, temperature, 0, 0.1);
  const [L, C, H] = profile.bark;
  const shade =
    species === 'pine'
      ? [L + tone * 0.075, C + Math.max(0, tone) * 0.02, H - tone * 7]
      : profile.bark;
  return swatch(profile, shade, mapHex, temperature, tone, 0.1);
}
