import { createColorScale, hexToOklch, paletteTheme } from '../palette.js';

// UI schemes never change the renderer's paletteTheme or saved palette seeds.
export function campaignUITheme(seeds, scheme = 'dark') {
  const color = createColorScale(seeds);
  const theme =
    scheme === 'light'
      ? {
          bg: color(0, 0.96, 0.24),
          text: color(2, 0.23, 0.2),
          muted: color(0, 0.4, 0.2),
          line: color(0, 0.6, 0.2),
        }
      : paletteTheme(seeds);
  return {
    ...theme,
    panel: createColorScale([theme.bg])(0, hexToOklch(theme.bg)[0], 0.925),
  };
}
