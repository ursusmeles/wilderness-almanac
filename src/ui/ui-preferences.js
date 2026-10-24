export const UI_PREFERENCES_KEY = 'wilderness-almanac:ui-v1';

// Explicit allowlist: campaigns, palettes and replay state never go here.
function pick(value = {}) {
  return {
    ...(typeof value.motion === 'boolean' ? { motion: value.motion } : {}),
    ...(typeof value.settingsOpen === 'boolean' ? { settingsOpen: value.settingsOpen } : {}),
    ...(Array.isArray(value.panelOrder) &&
    value.panelOrder.length === 2 &&
    new Set(value.panelOrder).size === 2 &&
    value.panelOrder.every((id) => ['tracker', 'inspector'].includes(id))
      ? { panelOrder: value.panelOrder }
      : {}),
    ...Object.fromEntries(
      ['panelsCollapsed', 'panelsHorizontal'].flatMap((key) =>
        typeof value[key]?.tracker === 'boolean' && typeof value[key]?.inspector === 'boolean'
          ? [[key, { tracker: value[key].tracker, inspector: value[key].inspector }]]
          : [],
      ),
    ),
  };
}

export function readUIPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem(UI_PREFERENCES_KEY));
    return saved?.version === 1 ? pick(saved) : {};
  } catch {
    return {};
  }
}

export function saveUIPreferences(storage, preferences) {
  try {
    storage.setItem(UI_PREFERENCES_KEY, JSON.stringify({ version: 1, ...pick(preferences) }));
    return true;
  } catch {
    return false;
  }
}
