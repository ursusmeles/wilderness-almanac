import { createColorScale, hexToOklch, contrastRatio } from './palette.js';

// Base shading remains independent of the chosen seed's lightness.
export const materialRoles = {
  ground: [0, 0.39, 1.1],
  groundLight: [0, 0.42, 0.95],
  side: [0, 0.26, 1],
  bevel: [0, 0.46, 0.9],
  water: [1, 0.48, 1.1],
  waterEdge: [1, 0.58, 0.85],
  waterDeep: [1, 0.33, 1],
  leaf: [2, 0.68, 1],
  leafLight: [2, 0.77, 0.85],
  leafDark: [2, 0.51, 0.9],
  trunk: [2, 0.32, 0.65],
  rock: [2, 0.65, 0.35],
  rockLight: [2, 0.82, 0.25],
  rockMid: [2, 0.55, 0.45],
  grass: [2, 0.63, 0.8],
  reeds: [2, 0.63, 0.8],
  reedHead: [2, 0.55, 0.45],
  soil: [0, 0.32, 0.65],
  crop: [2, 0.7, 0.8],
  ridge: [0, 0.43, 0.8],
  ridgeLight: [0, 0.5, 0.55],
  ridgeDark: [0, 0.35, 0.85],
  ridgeMeadow: [0, 0.39, 1.1],
  wall: [2, 0.87, 0.12],
  roof: [2, 0.49, 1.1],
  roofLight: [2, 0.62, 1],
  straw: [2, 0.76, 0.8],
  strawDark: [2, 0.64, 0.75],
  door: [2, 0.26, 0.6],
  riverShore: [0, 0.35, 0.85],
  riverGround: [0, 0.39, 1.1],
  riverCliff: [0, 0.32, 0.9],
  bridgeWood: [2, 0.61, 0.7],
  bridgeLight: [2, 0.74, 0.65],
  bridgeDark: [2, 0.35, 0.65],
  rope: [2, 0.76, 0.4],
  active: [2, 0.94, 0.55],
  hover: [2, 0.83, 0.4],
  wave: [1, 0.64, 0.75],
};

const darkAnchors = new Set([
  'side',
  'trunk',
  'door',
  'bridgeDark',
  'soil',
  'riverCliff',
  'ridgeDark',
]);
const foliage = new Set(['leaf', 'leafLight', 'leafDark']);
const roofs = new Set(['roof', 'roofLight']);
const straw = new Set(['straw', 'strawDark']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

// The existing presets occupy a quiet band; beyond it seed brightness has a
// smooth, bounded influence. Ground responds most, water less, props least.
function response(value, low, high, darker, lighter) {
  if (value < low) return -darker * smooth((low - value) / low);
  return lighter * smooth((value - high) / (1 - high));
}

// Five related roof finishes: palette, clay, ochre, slate and dark timber.
const roofFinishes = [
  { hue: 30, blend: 0.7, lightness: -0.015, chroma: 0.85 },
  { hue: 65, blend: 0.45, lightness: 0.025, chroma: 0.75 },
  { hue: 0, blend: 0, lightness: 0, chroma: 1 },
  { hue: 250, blend: 0.7, lightness: 0.015, chroma: 0.35, limit: 120 },
  { hue: 45, blend: 0.45, lightness: -0.055, chroma: 0.5 },
];

export function createMapPalette(seeds) {
  const fixed = createColorScale(seeds);
  const vivid = createColorScale(seeds, { preserveChroma: true });
  const coordinates = seeds.map(hexToOklch);
  const shifts = [
    response(coordinates[0][0], 0.25, 0.31, 0.11, 0.24),
    response(coordinates[1][0], 0.48, 0.65, 0.09, 0.12),
    response(coordinates[2][0], 0.73, 0.9, 0.045, 0.035),
  ];
  const ground = vivid(0, 0.39 + shifts[0], 1.1);

  function separate(
    index,
    lightness,
    chroma,
    backgrounds,
    minimum,
    low,
    high,
    extra = () => Infinity,
  ) {
    const score = (L) =>
      Math.min(extra(L), ...backgrounds.map((bg) => contrastRatio(vivid(index, L, chroma), bg)));
    if (score(lightness) >= minimum) return lightness;
    // Choose the nearest usable shade, preserving the family where possible.
    let best = clamp(lightness, low, high);
    let bestScore = score(best);
    for (let distance = 0.002; distance <= 0.9; distance += 0.002) {
      for (const direction of [1, -1]) {
        const candidate = lightness + direction * distance;
        if (candidate < low || candidate > high) continue;
        const candidateScore = score(candidate);
        if (candidateScore > bestScore) {
          best = candidate;
          bestScore = candidateScore;
        }
        if (candidateScore >= minimum) return candidate;
      }
    }
    return best;
  }
  const shore = vivid(0, 0.35 + shifts[0], 0.85);
  const waterL = separate(1, 0.48 + shifts[1], 1.1, [ground], 1.35, 0.31, 0.64, (L) =>
    contrastRatio(vivid(1, L + 0.1, 0.85), shore),
  );
  shifts[1] = waterL - 0.48;
  const water = vivid(1, waterL, 1.1);
  // Main crowns stay legible above terrain; shadow facets keep their depth.
  const leafL = separate(2, 0.68 + shifts[2], 1, [ground], 1.5, 0.64, 0.79);
  shifts[2] = leafL - 0.68;
  const wallL = clamp(Math.max(0.87 + shifts[2] * 0.15, leafL + 0.13), 0.85, 0.94);
  const activeL = separate(2, 0.94, 0.55, [ground, water], 2.5, 0.9, 0.96);
  const hoverL = separate(2, 0.83, 0.4, [ground, water], 1.8, 0.83, 0.96);
  const waveL = separate(1, 0.64 + shifts[1], 0.75, [water], 1.5, 0.55, 0.88);
  const cache = new Map();

  return {
    background: fixed.background,
    role(name, temperature = 0, tone = 0) {
      const key = `${name}:${temperature}:${tone}`;
      if (cache.has(key)) return cache.get(key);
      const [index, baseL, baseC] = materialRoles[name];
      let L = baseL;
      let C = baseC;
      let hueShift = 0;
      if (darkAnchors.has(name)) {
        const result = fixed(index, L, C, temperature);
        cache.set(key, result);
        return result;
      }
      L += shifts[index];
      if (foliage.has(name)) {
        L += tone * 0.014;
        hueShift = tone * 2;
      }
      if (name === 'wall') {
        L = wallL;
        // Plaster/stone stays nearly neutral, even under very saturated seeds.
        C = Math.min(C, 0.022 / Math.max(coordinates[index][1], 0.000001));
      }
      if (roofs.has(name)) {
        const finish = roofFinishes[clamp(tone + 2, 0, 4)];
        const hue = (coordinates[2][2] * 180) / Math.PI;
        const delta = ((finish.hue - hue + 540) % 360) - 180;
        hueShift = clamp(delta * finish.blend, -(finish.limit ?? 65), finish.limit ?? 65);
        L = baseL + response(coordinates[2][0], 0.73, 0.9, 0.045, 0.035) + finish.lightness;
        C *= finish.chroma;
      }
      if (straw.has(name)) {
        L += tone * 0.008;
        hueShift = tone * 4;
      }
      if (name === 'active') L = activeL;
      if (name === 'hover') L = hoverL;
      if (name === 'wave') L = waveL;
      const result = vivid(index, L, C, temperature, hueShift);
      cache.set(key, result);
      return result;
    },
  };
}
