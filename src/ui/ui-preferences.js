import { storageKey } from '../persistence/storage-namespace.js';
import { TIMES_OF_DAY } from '../application/time-of-day.js';

export const UI_PREFERENCES_KEY = 'wilderness-almanac:ui-v1';

function pickPanels(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return {
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

// Explicit allowlist: campaign content, palettes and replay state never go here.
function pick(value = {}) {
  const campaignPanels =
    value.campaignPanels &&
    typeof value.campaignPanels === 'object' &&
    !Array.isArray(value.campaignPanels)
      ? Object.fromEntries(
          Object.entries(value.campaignPanels).flatMap(([id, panels]) => {
            const picked = pickPanels(panels);
            return id.trim() && id.length <= 128 && Object.keys(picked).length
              ? [[id, picked]]
              : [];
          }),
        )
      : {};
  return {
    ...(typeof value.motion === 'boolean' ? { motion: value.motion } : {}),
    ...(TIMES_OF_DAY.includes(value.defaultTimeOfDay)
      ? { defaultTimeOfDay: value.defaultTimeOfDay }
      : {}),
    ...(typeof value.settingsOpen === 'boolean' ? { settingsOpen: value.settingsOpen } : {}),
    ...(Object.keys(campaignPanels).length ? { campaignPanels } : {}),
  };
}

export function readUIPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(storage, UI_PREFERENCES_KEY)));
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
