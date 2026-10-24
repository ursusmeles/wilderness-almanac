import { palettes, paletteNames, DEFAULT_PALETTE } from '../palette.js';

// Custom IDs keep default selection stable through renames, edits and deletions.
export function createPaletteLibrary(preferences) {
  const builtins = Object.entries(paletteNames).map(([id, name]) => ({
    id,
    name,
    colors: palettes[id],
    builtin: true,
  }));
  const ids = new Set();
  const custom = (preferences.palettes ?? []).map((palette) => {
    let id = palette.id;
    if (typeof id !== 'string' || !id.startsWith('custom:') || id.length > 128 || ids.has(id))
      id = `custom:${crypto.randomUUID()}`;
    ids.add(id);
    return { id, name: palette.name.trim(), colors: palette.colors.slice() };
  });
  const all = () => [...builtins, ...custom];
  const get = (id) => all().find((palette) => palette.id === id);
  let defaultId = get(preferences.defaultPalette) ? preferences.defaultPalette : DEFAULT_PALETTE;

  return {
    custom,
    all,
    get,
    default: () => get(defaultId),
    preferences: () => ({ palettes: custom, defaultPalette: defaultId }),
    add(colors = get(defaultId).colors) {
      const palette = {
        id: `custom:${crypto.randomUUID()}`,
        name: 'New palette',
        colors: colors.slice(),
      };
      custom.push(palette);
      return palette;
    },
    rename(id, name) {
      const palette = custom.find((palette) => palette.id === id);
      if (!palette || !name.trim() || name.trim().length > 60) return false;
      palette.name = name.trim();
      return true;
    },
    color(id, index, color) {
      const palette = custom.find((palette) => palette.id === id);
      if (!palette || ![0, 1, 2].includes(index) || !/^#[0-9a-f]{6}$/i.test(color)) return false;
      palette.colors[index] = color;
      return true;
    },
    remove(id) {
      const index = custom.findIndex((palette) => palette.id === id);
      if (index < 0) return false;
      custom.splice(index, 1);
      if (defaultId === id) defaultId = DEFAULT_PALETTE;
      return true;
    },
    restore(palette, index, wasDefault = false) {
      if (get(palette.id) || palette.builtin) return false;
      custom.splice(Math.min(index, custom.length), 0, palette);
      if (wasDefault) defaultId = palette.id;
      return true;
    },
    setDefault(id) {
      if (!get(id)) return false;
      defaultId = id;
      return true;
    },
  };
}
