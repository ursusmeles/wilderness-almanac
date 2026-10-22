import { hexToOklch } from '../palette.js';
import { createMapPalette } from '../map-palette.js';

export function partyColor(seeds) {
  const palette = createMapPalette(seeds);
  const lab = (hex) => {
    const [l, c, h] = hexToOklch(hex);
    return [l, c * Math.cos(h), c * Math.sin(h)];
  };
  const surfaces = ['ground', 'leaf', 'leafLight', 'roof', 'water'].map((role) =>
    lab(palette.role(role)),
  );
  return ['#ef365c', '#13d9f2', '#c4f532']
    .map((color) => ({
      color,
      score: Math.min(
        ...surfaces.map((surface) => Math.hypot(...lab(color).map((n, i) => n - surface[i]))),
      ),
    }))
    .sort((a, b) => b.score - a.score)[0].color;
}
