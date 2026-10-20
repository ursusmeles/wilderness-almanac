export const palettes = {
  dusk: ['#282039', '#237d89', '#e5b96e'],
  ember: ['#322333', '#2a6775', '#ed8965'],
  moss: ['#1e302c', '#477480', '#dad2a4'],
  alien: ['#30204c', '#d45b9d', '#bcf249'],
};

function linear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function encoded(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
export function hexToOklch(hex) {
  const rgb = [1, 3, 5].map((n) => linear(parseInt(hex.slice(n, n + 2), 16) / 255));
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

export function createColorScale(seeds, { preserveChroma = false } = {}) {
  function rgbOf(L, C, H) {
    const a = C * Math.cos(H),
      b = C * Math.sin(H);
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3),
      m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3),
      s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }
  const coordinates = seeds.map(hexToOklch);
  function color(index, L, Cscale = 1, temperature = 0, hueShift = 0) {
    const seed = coordinates[index].slice();
    L = Math.max(0.04, Math.min(0.96, L));
    if (temperature) {
      const target = ((temperature > 0 ? 25 : 250) * Math.PI) / 180;
      const hue = (seed[2] + Math.PI * 2) % (Math.PI * 2);
      // Keep warmth and coolness distinct along the red-to-blue landscape arc.
      const delta =
        hue >= (25 * Math.PI) / 180 && hue <= (250 * Math.PI) / 180
          ? target - hue
          : Math.atan2(Math.sin(target - hue), Math.cos(target - hue));
      seed[2] +=
        Math.sign(delta) *
        Math.min(Math.abs(delta), (8 * Math.PI) / 180) *
        Math.min(1, Math.abs(temperature));
    }
    seed[2] += (hueShift * Math.PI) / 180;
    let C = seed[1] * Cscale;
    let rgb = rgbOf(L, C, seed[2]);
    const inGamut = (values) => values.every((v) => v >= 0 && v <= 1);
    if (preserveChroma && !inGamut(rgb)) {
      // Fit only the excess chroma; retain hue/lightness and avoid coarse 10% steps.
      let low = 0;
      let high = C;
      for (let n = 0; n < 20; n++) {
        const middle = (low + high) / 2;
        if (inGamut(rgbOf(L, middle, seed[2]))) low = middle;
        else high = middle;
      }
      C = low;
      rgb = rgbOf(L, C, seed[2]);
    } else {
      // Keep the established colours for fixed dark anchors and the interface.
      for (let n = 0; n < 25 && !inGamut(rgb); n++) {
        C *= 0.9;
        rgb = rgbOf(L, C, seed[2]);
      }
    }
    return (
      '#' +
      rgb
        .map((v) =>
          Math.round(Math.max(0, Math.min(1, encoded(v))) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }

  const base = coordinates[0];
  color.background = () => color(0, Math.min(0.25, Math.max(0.16, base[0] - 0.015)), 1);
  return color;
}

export function paletteTheme(seeds) {
  const color = createColorScale(seeds);
  const bg = color.background();
  return { bg, text: color(2, 0.91, 0.2), muted: color(0, 0.73, 0.35), line: color(0, 0.38, 0.7) };
}

export function contrastRatio(a, b) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((n) => linear(parseInt(hex.slice(n, n + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
