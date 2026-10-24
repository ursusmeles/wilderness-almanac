import { validateCampaign } from '../application/campaigns.js';
import { paletteNames } from '../palette.js';
import {
  openDatabase,
  requested,
  transact,
  readDatabase,
  requestPersistence,
  STORES,
} from './database.js';
import { readLegacy, migrateLegacy } from './legacy-migration.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const revision = (row) => row?.revision ?? 0;
const conflict = () => {
  throw new Error('conflict');
};
const validRevision = (row) => Number.isSafeInteger(row?.revision) && row.revision > 0;
const unknownFields = (raw, validated) =>
  Object.fromEntries(Object.entries(raw).filter(([key]) => !Object.hasOwn(validated, key)));

function validatePalettes(value) {
  const ids = new Set();
  if (!Array.isArray(value?.palettes)) throw new Error('Invalid palette library');
  const palettes = value.palettes.map((palette) => {
    if (
      typeof palette?.id !== 'string' ||
      !palette.id.startsWith('custom:') ||
      palette.id.length > 128 ||
      ids.has(palette.id) ||
      typeof palette.name !== 'string' ||
      !palette.name.trim() ||
      palette.name.length > 60 ||
      !Array.isArray(palette.colors) ||
      palette.colors.length !== 3 ||
      !palette.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))
    )
      throw new Error('Invalid palette');
    ids.add(palette.id);
    return { id: palette.id, name: palette.name.trim(), colors: palette.colors.slice() };
  });
  if (!ids.has(value.defaultPalette) && !Object.hasOwn(paletteNames, value.defaultPalette))
    throw new Error('Invalid default palette');
  return { palettes, defaultPalette: value.defaultPalette };
}

function validateDeleted(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value?.index) || value.index < 0) throw new Error('Invalid deletion');
  return { index: value.index, campaign: validateCampaign(value.campaign) };
}

// Browser persistence owns no live world/renderer/UI state. Records are replay
// data; each campaign's edits, dressing, party and visits commit together.
export async function createBrowserStore({
  indexedDB = globalThis.indexedDB,
  legacyStorage,
  storageManager,
} = {}) {
  const legacy = readLegacy(legacyStorage);
  let db;
  let data;
  let reason = null;
  let readOnly = false;
  let preservedCount = legacy.reader.status().preservedCount;
  let preservedPreferences = legacy.preservedPreferences;
  let durability = 'unknown';
  let libraryRow;
  let paletteRow;
  let deletedRow;
  let activeRow;
  let campaignRows = new Map();
  let paletteRows = new Map();
  let baseline = new Map();
  let paletteBaseline;
  let deletedBaseline = null;
  let currentCampaigns = legacy.campaigns;
  let currentDeleted = legacy.reader.deletedCampaign;
  let currentPalettes = legacy.library;
  let pending;
  let running = false;
  let pendingCount = 0;
  const unsaved = { campaigns: false, palettes: false };
  const failures = {};
  const unreadableIds = [];
  const subscribers = new Set();
  const notify = () => {
    for (const callback of subscribers) callback();
  };
  try {
    db = await openDatabase(indexedDB);
    db.onversionchange = () => {
      db.close();
      readOnly = true;
      reason = 'versionchange';
      notify();
    };
    data = await migrateLegacy(db, legacyStorage, legacy);
    const marker = data.settings.find(({ id }) => id === 'migration');
    readOnly = marker.value.readOnly;
    reason = readOnly ? 'unreadable' : null;
    preservedCount = marker.value.preservedCount;
    preservedPreferences = Boolean(marker.value.preservedPreferences);
    libraryRow = data.settings.find(({ id }) => id === 'library');
    paletteRow = data.settings.find(({ id }) => id === 'palettes');
    deletedRow = data.recovery.find(({ id }) => id === 'deleted');
    activeRow = data.settings.find(({ id }) => id === 'activeCampaign');
    if (
      !validRevision(libraryRow) ||
      !validRevision(paletteRow) ||
      !Array.isArray(libraryRow.value) ||
      !libraryRow.value.every(
        (id) => typeof id === 'string' && id.length > 0 && id.length <= 128,
      ) ||
      new Set(libraryRow.value).size !== libraryRow.value.length
    )
      throw new Error('unreadable');
    campaignRows = new Map(data.campaigns.map((row) => [row.id, row]));
    currentCampaigns = [];
    for (const id of libraryRow.value) {
      try {
        const row = campaignRows.get(id);
        if (!validRevision(row) || row.value.id !== id) throw new Error('unreadable');
        const campaign = validateCampaign(row.value);
        currentCampaigns.push(campaign);
        // Library cards edit live records in place. The committed baseline
        // must never alias those objects or a rename could look unchanged.
        baseline.set(id, validateCampaign(row.value));
      } catch {
        // Keep the original row and library identity, never replace it via a
        // stale library snapshot merely because this app cannot open it.
        preservedCount++;
        unreadableIds.push(id);
      }
    }
    paletteRows = new Map(data.palettes.map((row) => [row.id, row]));
    currentPalettes = validatePalettes({
      palettes: paletteRow.value.ids.map((id) => {
        const row = paletteRows.get(id);
        if (!validRevision(row) || row.value.id !== id) throw new Error('unreadable');
        return row.value;
      }),
      defaultPalette: paletteRow.value.defaultPalette,
    });
    paletteBaseline = validatePalettes(currentPalettes);
    currentDeleted = deletedRow ? validateDeleted(deletedRow.value) : null;
    if (
      currentDeleted &&
      (!validRevision(deletedRow) || libraryRow.value.includes(currentDeleted.campaign.id))
    )
      throw new Error('unreadable');
    deletedBaseline = validateDeleted(currentDeleted);
  } catch (error) {
    readOnly = true;
    reason = /conflict/.test(error.message)
      ? 'conflict'
      : error.message === 'unreadable'
        ? 'unreadable'
        : 'unavailable';
    // On a failed migration, the untouched legacy library remains usable in
    // memory. On a damaged primary store its raw rows remain downloadable.
    if (db && !data) data = await readDatabase(db).catch(() => undefined);
  }
  // Permission refusal never disables saves. Do not delay boot on a prompt.
  void requestPersistence(storageManager).then((value) => {
    durability = value;
    notify();
  });

  async function commit(change) {
    if (readOnly || !db) return false;
    try {
      const nextCampaigns = change.campaigns;
      const nextDeleted = change.deletedCampaign;
      const nextPalettes = change.palettes;
      const activeChanged =
        change.activeCampaignId !== undefined && change.activeCampaignId !== activeRow?.value;
      const changed = nextCampaigns?.filter((value) => !equal(baseline.get(value.id), value)) ?? [];
      const removed = nextCampaigns
        ? [...baseline.keys()].filter((id) => !nextCampaigns.some((value) => value.id === id))
        : [];
      const membersChanged = Boolean(
        nextCampaigns &&
        !equal(
          nextCampaigns.map(({ id }) => id),
          [...baseline.keys()],
        ),
      );
      const deletionChanged = nextDeleted !== undefined && !equal(nextDeleted, deletedBaseline);
      const palettesChanged = nextPalettes !== undefined && !equal(nextPalettes, paletteBaseline);
      if (
        !changed.length &&
        !removed.length &&
        !membersChanged &&
        !deletionChanged &&
        !palettesChanged &&
        !activeChanged
      ) {
        if (!readOnly) reason = null;
        return true;
      }
      const updates = await transact(db, STORES, 'readwrite', async (stores) => {
        const updates = { campaigns: new Map(), palettes: new Map() };
        const clock = await requested(stores.settings.get('clock'));
        const nextRevision = (clock?.value ?? 1) + 1;
        if (!Number.isSafeInteger(nextRevision)) throw new Error('Revision limit reached');
        stores.settings.put({ id: 'clock', value: nextRevision });
        if (activeChanged) {
          const target = await requested(stores.campaigns.get(change.activeCampaignId));
          if (!target && !changed.some(({ id }) => id === change.activeCampaignId)) conflict();
          updates.active = { id: 'activeCampaign', value: change.activeCampaignId };
          stores.settings.put(updates.active);
        }
        if (membersChanged) {
          const current = await requested(stores.settings.get('library'));
          if (revision(current) !== revision(libraryRow)) conflict();
          updates.library = {
            ...current,
            revision: revision(current) + 1,
            value: [...nextCampaigns.map(({ id }) => id), ...unreadableIds],
          };
          stores.settings.put(updates.library);
        }
        for (const value of changed) {
          const current = await requested(stores.campaigns.get(value.id));
          const expected = campaignRows.get(value.id);
          if (unreadableIds.includes(value.id)) conflict();
          if (revision(current) !== revision(expected)) conflict();
          // Restore unknown local fields too, including after deletion Undo.
          const original =
            current?.value ??
            (deletedRow?.value?.campaign?.id === value.id ? deletedRow.value.campaign : {});
          const row = {
            id: value.id,
            revision: nextRevision,
            value: { ...unknownFields(original, baseline.get(value.id) ?? value), ...value },
          };
          // Known fields removed by reset/replacement must stay removed.
          for (const key of ['hexEdits', 'partyToken', 'fogOfWar', 'preferences'])
            if (!Object.hasOwn(value, key)) delete row.value[key];
          stores.campaigns.put(row);
          updates.campaigns.set(value.id, row);
        }
        for (const id of removed) {
          const current = await requested(stores.campaigns.get(id));
          if (revision(current) !== revision(campaignRows.get(id))) conflict();
          stores.campaigns.delete(id);
          // Future journal rows belong to the deleted campaign. No journal
          // actions are implemented yet; deletion already owns their lifecycle.
          const keys = await requested(stores.journal.index('campaign').getAllKeys(id));
          for (const key of keys) stores.journal.delete(key);
        }
        if (deletionChanged) {
          const current = await requested(stores.recovery.get('deleted'));
          if (revision(current) !== revision(deletedRow)) conflict();
          // Retain a tombstone revision so delete/restore ABA cannot pass CAS.
          let value = nextDeleted;
          if (value) {
            const original =
              campaignRows.get(value.campaign.id)?.value ?? deletedRow?.value?.campaign ?? {};
            value = {
              ...value,
              campaign: {
                ...unknownFields(original, baseline.get(value.campaign.id) ?? value.campaign),
                ...value.campaign,
              },
            };
          }
          updates.deleted = { id: 'deleted', revision: revision(current) + 1, value };
          stores.recovery.put(updates.deleted);
        }
        if (palettesChanged) {
          const current = await requested(stores.settings.get('palettes'));
          if (revision(current) !== revision(paletteRow)) conflict();
          updates.paletteSettings = {
            id: 'palettes',
            revision: revision(current) + 1,
            value: {
              ids: nextPalettes.palettes.map(({ id }) => id),
              defaultPalette: nextPalettes.defaultPalette,
            },
          };
          stores.settings.put(updates.paletteSettings);
          for (const palette of nextPalettes.palettes) {
            const changed = !equal(paletteRows.get(palette.id)?.value, palette);
            const row = changed
              ? { id: palette.id, revision: nextRevision, value: palette }
              : paletteRows.get(palette.id);
            if (changed) stores.palettes.put(row);
            updates.palettes.set(palette.id, row);
          }
          for (const id of paletteRows.keys())
            if (!nextPalettes.palettes.some((palette) => palette.id === id))
              stores.palettes.delete(id);
        }
        return updates;
      });
      if (updates.library) libraryRow = updates.library;
      if (updates.active) activeRow = updates.active;
      for (const [id, row] of updates.campaigns) campaignRows.set(id, row);
      for (const id of removed) campaignRows.delete(id);
      if (nextCampaigns) baseline = new Map(nextCampaigns.map((value) => [value.id, value]));
      if (updates.deleted) {
        deletedRow = updates.deleted;
        deletedBaseline = nextDeleted;
      }
      if (updates.paletteSettings) {
        paletteRow = updates.paletteSettings;
        paletteRows = updates.palettes;
        paletteBaseline = nextPalettes;
      }
      if (!readOnly) reason = null;
      return true;
    } catch (error) {
      reason =
        error.message === 'conflict'
          ? 'conflict'
          : error.name === 'QuotaExceededError'
            ? 'quota'
            : 'unavailable';
      if (reason === 'conflict') readOnly = true;
      return false;
    }
  }

  async function drain() {
    running = true;
    while (pending) {
      const batch = pending;
      pending = undefined;
      const success = await commit(batch.change);
      for (const target of ['campaigns', 'palettes']) {
        if (batch.change[target] === undefined) continue;
        unsaved[target] = !success || pending?.change[target] !== undefined;
        if (success) delete failures[target];
        else failures[target] = reason ?? 'unavailable';
      }
      if (!readOnly) reason = Object.values(failures)[0] ?? null;
      pendingCount -= batch.waiters.length;
      for (const resolve of batch.waiters) resolve(success);
      notify();
    }
    running = false;
  }

  return {
    campaigns: currentCampaigns,
    deletedCampaign: currentDeleted,
    preferences: {
      ...legacy.preferences,
      ...currentPalettes,
      ...(typeof activeRow?.value === 'string' ? { campaignId: activeRow.value } : {}),
    },
    status: () => ({
      reason,
      readOnly,
      preservedCount,
      preservedPreferences,
      pending: pendingCount > 0,
      unsaved: unsaved.campaigns || unsaved.palettes,
      durability,
      hasRecovery: Boolean(data || Object.values(legacy.sources).some((value) => value != null)),
    }),
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    save({ campaigns, deletedCampaign, palettes, activeCampaignId } = {}) {
      let change;
      try {
        change = {};
        if (campaigns !== undefined) {
          change.campaigns = campaigns.map(validateCampaign);
          const ids = new Set(change.campaigns.map(({ id }) => id));
          if (ids.size !== campaigns.length) throw new Error('Duplicate campaign');
          change.deletedCampaign = validateDeleted(deletedCampaign ?? null);
          if (change.deletedCampaign && ids.has(change.deletedCampaign.campaign.id))
            throw new Error('Ambiguous deletion');
        }
        if (palettes !== undefined) change.palettes = validatePalettes(palettes);
        if (activeCampaignId !== undefined) {
          if (
            typeof activeCampaignId !== 'string' ||
            !change.campaigns?.some(({ id }) => id === activeCampaignId)
          )
            throw new Error('Invalid active campaign');
          change.activeCampaignId = activeCampaignId;
        }
      } catch {
        reason = 'invalid';
        notify();
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        for (const target of ['campaigns', 'palettes'])
          if (change[target] !== undefined) unsaved[target] = true;
        // Bound transient full snapshots to one in-flight and one pending
        // batch, even during colour-input bursts. Callers settle on commit.
        pending ??= { change: {}, waiters: [] };
        Object.assign(pending.change, change);
        pending.waiters.push(resolve);
        pendingCount++;
        notify();
        if (!running) void drain();
      });
    },
    async recovery() {
      const snapshot = db ? await readDatabase(db).catch(() => data) : data;
      return JSON.stringify(
        {
          format: 'wilderness-almanac-recovery',
          version: 1,
          database: snapshot ?? null,
          legacy: legacy.sources,
        },
        null,
        2,
      );
    },
    close() {
      db?.close();
      subscribers.clear();
    },
  };
}
