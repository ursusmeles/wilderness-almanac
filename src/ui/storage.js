const KEY = 'hex-sandbox:map-v1';
const validColors = (colors) =>
  Array.isArray(colors) &&
  colors.length === 3 &&
  colors.every((color) => /^#[0-9a-f]{6}$/i.test(color));

export function readPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved?.version !== 1) return {};
    return {
      seed:
        typeof saved.seed === 'string' && saved.seed.trim() && saved.seed.length <= 128
          ? saved.seed
          : undefined,
      variant: Number.isSafeInteger(saved.variant) && saved.variant >= 0 ? saved.variant : 0,
      colors: validColors(saved.colors) ? saved.colors : undefined,
      ...(typeof saved.campaignId === 'string' && saved.campaignId.length <= 128
        ? { campaignId: saved.campaignId }
        : {}),
      ...(typeof saved.motion === 'boolean' ? { motion: saved.motion } : {}),
      palettes: Array.isArray(saved.palettes)
        ? saved.palettes.filter(
            (palette) =>
              typeof palette.name === 'string' &&
              palette.name.trim() &&
              palette.name.length <= 60 &&
              validColors(palette.colors),
          )
        : [],
    };
  } catch {
    return {};
  }
}

export function savePreferences(storage, preferences) {
  try {
    storage.setItem(KEY, JSON.stringify({ version: 1, ...preferences }));
    return true;
  } catch {
    return false;
  }
}
