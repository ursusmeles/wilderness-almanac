import { createCampaignStore } from './legacy-campaigns.js';
import { readPreferences } from './legacy-preferences.js';
import { createPaletteLibrary } from '../application/palette-library.js';
import { createCampaign, validateCampaign } from '../application/campaigns.js';
import { generateWorld } from '../generation/world.js';
import { paletteNames, palettes, DEFAULT_PALETTE } from '../palette.js';
import { requested, transact, readDatabase, STORES } from './database.js';

export const LEGACY_CAMPAIGNS = 'wilderness-almanac:campaigns-v1';
export const LEGACY_PREFERENCES = 'hex-sandbox:map-v1';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function understoodPreferences(source, preferences, library) {
  if (source == null) return true;
  try {
    const raw = JSON.parse(source);
    if (raw?.version !== 1) return false;
    return (
      Object.keys(raw).every(
        (key) =>
          key === 'version' ||
          (Object.hasOwn(preferences, key) && equal(raw[key], preferences[key])),
      ) &&
      (raw.defaultPalette === undefined || raw.defaultPalette === library.defaultPalette) &&
      (!raw.palettes ||
        raw.palettes.every((palette) =>
          Object.keys(palette).every((key) => ['id', 'name', 'colors'].includes(key)),
        ))
    );
  } catch {
    return false;
  }
}

export function readLegacy(storage) {
  const sources = {};
  let unavailable = false;
  for (const key of [LEGACY_CAMPAIGNS, LEGACY_PREFERENCES]) {
    try {
      sources[key] = storage.getItem(key) ?? null;
    } catch {
      unavailable = true;
    }
  }
  const reader = createCampaignStore({ getItem: () => sources[LEGACY_CAMPAIGNS] });
  const preferences = readPreferences({ getItem: () => sources[LEGACY_PREFERENCES] });
  const library = createPaletteLibrary(preferences).preferences();
  const campaigns = reader.campaigns.slice();
  // The pre-library application saved one version-6 map in preferences.
  if (!unavailable && reader.missing && preferences.seed) {
    const colors = preferences.colors ?? palettes[DEFAULT_PALETTE];
    const paletteName = Object.keys(palettes).find((id) => equal(palettes[id], colors));
    const campaign = createCampaign(
      generateWorld(preferences.seed, { generatorVersion: 6 }),
      colors,
      paletteNames[paletteName] ?? 'Custom',
      preferences.variant,
    );
    // Stable identity makes concurrent/retried migrations idempotent.
    campaign.id = 'legacy-single-map';
    campaigns.push(campaign);
  }
  return {
    sources,
    reader,
    preferences,
    library,
    campaigns,
    unavailable,
    preservedPreferences: !understoodPreferences(sources[LEGACY_PREFERENCES], preferences, library),
  };
}

function originalCampaign(legacy, campaign) {
  try {
    const envelope = JSON.parse(legacy.sources[LEGACY_CAMPAIGNS]);
    const raw = [...envelope.campaigns, envelope.deletedCampaign?.campaign].find((raw) => {
      try {
        return raw.id === campaign.id && equal(validateCampaign(raw), campaign);
      } catch {
        return false;
      }
    });
    return { ...raw, ...campaign };
  } catch {
    return campaign;
  }
}

// First copy every legacy source verbatim, plus usable records, in one commit.
// Never clear/replace an existing database during a migration retry.
export async function migrateLegacy(db, storage, legacy) {
  await transact(db, STORES, 'readwrite', async (stores) => {
    if (await requested(stores.settings.get('migration'))) return;
    if (legacy.unavailable) throw new Error('legacy-unavailable');
    const status = legacy.reader.status();
    for (const [id, source] of Object.entries(legacy.sources))
      if (source !== null) stores.recovery.put({ id, source });
    for (const campaign of legacy.campaigns)
      stores.campaigns.add({
        id: campaign.id,
        revision: 1,
        value: originalCampaign(legacy, campaign),
      });
    for (const palette of legacy.library.palettes)
      stores.palettes.add({ id: palette.id, revision: 1, value: palette });
    stores.settings.add({
      id: 'library',
      revision: 1,
      value: legacy.campaigns.map(({ id }) => id),
    });
    stores.settings.add({
      id: 'palettes',
      revision: 1,
      value: {
        ids: legacy.library.palettes.map(({ id }) => id),
        defaultPalette: legacy.library.defaultPalette,
      },
    });
    if (legacy.campaigns.some(({ id }) => id === legacy.preferences.campaignId))
      stores.settings.add({ id: 'activeCampaign', value: legacy.preferences.campaignId });
    if (legacy.reader.deletedCampaign) {
      const deleted = legacy.reader.deletedCampaign;
      stores.recovery.add({
        id: 'deleted',
        revision: 1,
        value: {
          ...deleted,
          campaign: originalCampaign(legacy, deleted.campaign),
        },
      });
    }
    stores.settings.add({
      id: 'migration',
      value: {
        version: 1,
        verified: false,
        readOnly: status.readOnly,
        preservedCount: status.preservedCount,
        preservedPreferences: legacy.preservedPreferences,
      },
    });
  });

  // A separate read transaction verifies the committed records before retiring
  // localStorage. Interrupted cleanup is harmless: the next boot repeats it.
  const data = await readDatabase(db);
  const marker = data.settings.find(({ id }) => id === 'migration');
  if (
    marker?.value.version !== 1 ||
    typeof marker.value.verified !== 'boolean' ||
    typeof marker.value.readOnly !== 'boolean' ||
    !Number.isSafeInteger(marker.value.preservedCount) ||
    marker.value.preservedCount < 0
  )
    throw new Error('unreadable');
  const sources = new Map(
    data.recovery.filter((row) => 'source' in row).map((row) => [row.id, row.source]),
  );
  // An already verified primary store stays usable when localStorage is
  // subsequently disabled. First-run reads must still succeed before import.
  if (legacy.unavailable && marker.value.verified) return data;
  for (const key of [LEGACY_CAMPAIGNS, LEGACY_PREFERENCES]) {
    const current = storage?.getItem(key) ?? null;
    if (current !== null && current !== sources.get(key)) throw new Error('legacy-conflict');
  }
  if (!marker.value.verified) {
    if (
      legacy.campaigns.some(({ id }) => id === legacy.preferences.campaignId) &&
      data.settings.find(({ id }) => id === 'activeCampaign')?.value !==
        legacy.preferences.campaignId
    )
      throw new Error('migration-validation');
    if (
      !equal(
        data.settings.find(({ id }) => id === 'library')?.value,
        legacy.campaigns.map(({ id }) => id),
      )
    )
      throw new Error('migration-validation');
    for (const campaign of legacy.campaigns) {
      const stored = data.campaigns.find(({ id }) => id === campaign.id);
      // Concurrent single-map migrations share replay identity but the first
      // transaction owns the newly assigned creation time.
      const expected =
        campaign.id === 'legacy-single-map' && legacy.reader.missing
          ? { ...campaign, createdAt: stored?.value.createdAt }
          : campaign;
      if (!stored || !equal(validateCampaign(stored.value), expected))
        throw new Error('migration-validation');
    }
    const paletteSettings = data.settings.find(({ id }) => id === 'palettes');
    if (paletteSettings.value.defaultPalette !== legacy.library.defaultPalette)
      throw new Error('migration-validation');
    // Use the committed IDs: another tab may have assigned IDs to legacy palettes.
    const migratedPalettes = paletteSettings.value.ids.map(
      (id) => data.palettes.find((row) => row.id === id)?.value,
    );
    if (
      !equal(
        migratedPalettes.map(({ name, colors }) => ({ name, colors })),
        legacy.library.palettes.map(({ name, colors }) => ({ name, colors })),
      )
    )
      throw new Error('migration-validation');
    if (
      legacy.reader.deletedCampaign &&
      !equal(
        validateCampaign(data.recovery.find(({ id }) => id === 'deleted')?.value.campaign),
        legacy.reader.deletedCampaign.campaign,
      )
    )
      throw new Error('migration-validation');
    for (const [key, source] of Object.entries(legacy.sources))
      if (source !== null && sources.get(key) !== source) throw new Error('migration-validation');
    await transact(db, ['settings'], 'readwrite', async ({ settings }) => {
      const current = await requested(settings.get('migration'));
      settings.put({ ...current, value: { ...current.value, verified: true } });
    });
  }
  // Unreadable/unknown sources remain at their original key as well as in the
  // bounded recovery archive. Never scrub data we only partially understood.
  for (const key of [LEGACY_CAMPAIGNS, LEGACY_PREFERENCES]) {
    const source = sources.get(key);
    if (source == null) continue;
    let understood = false;
    try {
      const parsed = JSON.parse(source);
      understood =
        parsed?.version === 1 &&
        (key === LEGACY_CAMPAIGNS
          ? !legacy.reader.status().readOnly && !legacy.reader.status().preservedCount
          : !legacy.preservedPreferences);
    } catch {
      /* Retain unreadable source. */
    }
    if (understood && storage.getItem(key) === source) {
      try {
        storage.removeItem(key);
      } catch {
        /* Retry cleanup on next boot. */
      }
    }
  }
  return data;
}
