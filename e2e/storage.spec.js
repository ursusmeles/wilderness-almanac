import { seedCampaigns } from './data.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { campaign } from './fixtures.js';

const key = 'wilderness-almanac:campaigns-v1';
const preferencesKey = 'hex-sandbox:map-v1';
const palette = {
  id: 'custom:test',
  name: 'Test palette',
  colors: ['#112233', '#334455', '#667788'],
};

test('account sync metadata survives reload, isolates accounts and rejects stale acknowledgments', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    const state = { remoteRevision: 1, hash: 'a'.repeat(64) };
    await store.rememberRemote('alice', 'test-campaign', state);
    const acknowledged = await store.remoteState('alice', 'test-campaign');
    await store.rememberRemote(
      'alice',
      'test-campaign',
      { ...state, remoteRevision: 2 },
      acknowledged,
    );
    let conflict = false;
    try {
      await store.rememberRemote('alice', 'test-campaign', state, acknowledged);
    } catch {
      conflict = true;
    }
    store.close();
    const reloaded = await window.boot();
    const current = await reloaded.remoteState('alice', 'test-campaign');
    const other = await reloaded.remoteState('bob', 'test-campaign');
    const count = reloaded.campaigns.length;
    reloaded.close();
    return { current, other, conflict, count };
  });
  expect(result.current.value.remoteRevision).toBe(2);
  expect(result.other).toBeUndefined();
  expect(result.conflict).toBe(true);
  expect(result.count).toBe(1);
});

async function prepare(page) {
  // Raw storage tests exercise the real browser API without starting the app.
  await page.route('**/src/main.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    window.createStore = (await import('/src/persistence/browser-store.js')).createBrowserStore;
    const module = await import('/src/persistence/database.js');
    window.readDB = async () => {
      const db = await module.openDatabase(indexedDB);
      try {
        return await module.readDatabase(db);
      } finally {
        db.close();
      }
    };
    window.boot = () => window.createStore();
  });
}

const seed = (page, campaigns = [campaign], preferences = {}) =>
  seedCampaigns(page, campaigns, preferences);

test('journal rows commit with party state, survive reload and deletion Undo, and reject stale tabs atomically', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { createCampaign } = await import('/src/application/campaigns.js');
    const { generateWorld } = await import('/src/generation/world.js');
    const { createCampaignSession } = await import('/src/application/campaign-session.js');
    const store = await window.boot();
    const record = createCampaign(
      generateWorld('heliotest'),
      ['#cdab8f', '#0b365e', '#11b329'],
      'Test',
    );
    const session = createCampaignSession({
      persist: async (campaign) => {
        const saved = await store.save({ campaigns: [campaign] });
        return { campaignSaved: saved, preferencesSaved: saved };
      },
    });
    session.open(record);
    session.moveParty('1,0');
    session.partyDetails({ name: 'Wayfarers' });
    session.nextWeek();
    session.addJournal('<img src=x onerror=alert(1)>');
    await session.save();
    const saved = session.snapshot().campaign;
    const raw = await window.readDB();
    const count = raw.journal.length,
      inline = raw.campaigns[0].value.journal;
    const reloaded = await window.boot();
    const restored = reloaded.campaigns[0];
    reloaded.close();
    await store.save({ campaigns: [], deletedCampaign: { index: 0, campaign: saved } });
    const deletedCount = (await window.readDB()).journal.length;
    await store.save({ campaigns: [saved], deletedCampaign: null });
    const undoCount = (await window.readDB()).journal.length;
    const stale = await window.boot();
    session.nextWeek();
    await session.save();
    const conflict = await stale.save({
      campaigns: [{ ...stale.campaigns[0], name: 'Stale name' }],
    });
    stale.close();
    const beforeFailure = await window.readDB();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'journal') throw new DOMException('Simulated quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
    session.moveParty('-1,0');
    const failed = await session.save();
    IDBObjectStore.prototype.put = put;
    const afterFailure = await window.readDB();
    const live = session.snapshot().campaign;
    const recovery = JSON.parse(await store.recovery());
    store.close();
    return {
      count,
      inline,
      restored,
      saved,
      deletedCount,
      undoCount,
      conflict,
      beforeFailure,
      afterFailure,
      failed,
      live,
      recovery,
    };
  });
  expect(result.count).toBe(4);
  expect(result.inline).toBeUndefined();
  expect(result.restored).toEqual(result.saved);
  expect(result.deletedCount).toBe(0);
  expect(result.undoCount).toBe(4);
  expect(result.conflict).toBe(false);
  expect(result.failed.saved).toBe(false);
  expect(result.afterFailure.campaigns).toEqual(result.beforeFailure.campaigns);
  expect(result.afterFailure.journal).toEqual(result.beforeFailure.journal);
  expect(result.live.partyToken.key).toBe('-1,0');
  expect(result.recovery.database.journal).toEqual(result.beforeFailure.journal);
});

test('inline journal records become separate rows without losing unchanged entries', async ({
  page,
}) => {
  await prepare(page);
  const journal = [{ id: 1, week: 1, kind: 'note', text: 'An older saved note', mentions: [] }];
  await seed(page, [{ ...campaign, journal }]);
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    const value = { ...store.campaigns[0], name: 'New campaign name' };
    const saved = await store.save({ campaigns: [value] });
    store.close();
    const reloaded = await window.boot();
    const journal = reloaded.campaigns[0].journal;
    reloaded.close();
    const raw = await window.readDB();
    return { saved, journal, raw };
  });
  expect(result.saved).toBe(true);
  expect(result.journal).toEqual(journal);
  expect(result.raw.journal).toHaveLength(1);
  expect(result.raw.campaigns[0].value.journal).toBeUndefined();
});

test('ambiguous earlier database namespaces block writes without creating an empty library', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { openDatabase, DATABASE_NAME } = await import('/src/persistence/database.js');
    for (const prefix of ['previous-product', 'other-product']) {
      const db = await openDatabase({
        databases: async () => [],
        open: (_name, version) => indexedDB.open(`${prefix}:campaigns`, version),
      });
      db.close();
    }
    const store = await window.boot();
    const saved = await store.save({ campaigns: [] });
    const result = {
      saved,
      readOnly: store.status().readOnly,
      createdEmpty: (await indexedDB.databases()).some(({ name }) => name === DATABASE_NAME),
    };
    store.close();
    return result;
  });
  expect(result).toEqual({ saved: false, readOnly: true, createdEmpty: false });
});

test('campaign and palette updates roll back together on an aborted write and can retry', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(
    async ({ palette }) => {
      const store = await window.boot();
      const next = {
        campaigns: [
          {
            ...store.campaigns[0],
            name: 'Unsaved',
            partyToken: { key: '1,0', style: 'warden' },
            hexEdits: { version: 1, cells: { '1,0': { visited: true } } },
          },
        ],
        palettes: { palettes: [palette], defaultPalette: palette.id },
      };
      const before = await window.readDB();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value) {
        if (this.name === 'palettes') throw new DOMException('Full', 'QuotaExceededError');
        return put.call(this, value);
      };
      const failed = await store.save(next);
      const status = store.status();
      const after = await window.readDB();
      IDBObjectStore.prototype.put = put;
      // A successful unrelated target cannot hide the failed campaign write.
      await store.save({ palettes: store.preferences });
      const stillUnsaved = store.status().unsaved;
      const retried = await store.save(next);
      const persisted = await window.readDB();
      store.close();
      const reload = await window.boot();
      const result = {
        failed,
        status,
        before,
        after,
        stillUnsaved,
        retried,
        persisted,
        campaign: reload.campaigns[0],
        preferences: reload.preferences,
      };
      reload.close();
      return result;
    },
    { palette },
  );
  expect(result.failed).toBe(false);
  expect(result.status).toMatchObject({ reason: 'quota', unsaved: true });
  expect(result.after).toEqual(result.before);
  expect(result.stillUnsaved).toBe(true);
  expect(result.retried).toBe(true);
  expect(result.campaign).toMatchObject({
    name: 'Unsaved',
    partyToken: { key: '1,0' },
    hexEdits: { cells: { '1,0': { visited: true } } },
  });
  expect(result.preferences.defaultPalette).toBe(palette.id);
});

test('competing tabs reject stale edits while independent campaigns can save', async ({
  page,
  context,
}) => {
  await prepare(page);
  await seed(page, [campaign, { ...campaign, id: 'second', name: 'Second' }]);
  await page.evaluate(async () => {
    window.store = await window.boot();
  });
  const other = await context.newPage();
  await prepare(other);
  await other.evaluate(async () => {
    window.store = await window.boot();
  });
  expect(
    await page.evaluate(() =>
      window.store.save({
        campaigns: window.store.campaigns.map((value, index) =>
          index ? value : { ...value, name: 'First tab' },
        ),
      }),
    ),
  ).toBe(true);
  expect(
    await other.evaluate(() =>
      window.store.save({
        campaigns: window.store.campaigns.map((value, index) =>
          index ? { ...value, name: 'Second tab' } : value,
        ),
      }),
    ),
  ).toBe(true);
  expect(
    await other.evaluate(() =>
      window.store.save({
        campaigns: window.store.campaigns.map((value) => ({ ...value, name: 'Stale' })),
      }),
    ),
  ).toBe(false);
  const result = await other.evaluate(async () => ({
    status: window.store.status(),
    records: (await window.readDB()).campaigns,
  }));
  expect(result.status).toMatchObject({ reason: 'conflict', readOnly: true, unsaved: true });
  expect(result.records.map((row) => row.value.name)).toEqual(['Second tab', 'First tab']);
  await page.evaluate(() => window.store.close());
  await other.evaluate(() => window.store.close());
});

test('rapid saves keep one current campaign, bounded recovery, and an independent journal store', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    const outcomes = await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        store.save({ campaigns: [{ ...store.campaigns[0], name: `Action ${index}` }] }),
      ),
    );
    const data = await window.readDB();
    store.close();
    return { outcomes, data };
  });
  expect(result.outcomes.every(Boolean)).toBe(true);
  expect(result.data.campaigns).toHaveLength(1);
  expect(result.data.campaigns[0].value.name).toBe('Action 59');
  expect(result.data.recovery.length).toBeLessThanOrEqual(3);
  expect(result.data.journal).toEqual([]);
});

test('in-place library names, icons and palette changes do not mutate committed baselines', async ({
  page,
}) => {
  await prepare(page);
  await seed(page, [campaign], { palettes: [palette], defaultPalette: palette.id });
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    store.campaigns[0].name = 'Renamed in library';
    store.campaigns[0].iconKey = '1,0';
    store.preferences.palettes[0].name = 'Renamed palette';
    await store.save({ campaigns: store.campaigns, palettes: store.preferences });
    store.close();
    const reload = await window.boot();
    const result = { campaign: reload.campaigns[0], palette: reload.preferences.palettes[0] };
    reload.close();
    return result;
  });
  expect(result.campaign).toMatchObject({ name: 'Renamed in library', iconKey: '1,0' });
  expect(result.palette.name).toBe('Renamed palette');
});

test('deletion Undo preserves unknown fields and rejects a tab from before delete/restore', async ({
  page,
}) => {
  await prepare(page);
  await seed(page, [{ ...campaign, future: { retained: true } }]);
  const result = await page.evaluate(async () => {
    const first = await window.boot();
    const stale = await window.boot();
    const campaign = first.campaigns[0];
    await first.save({ campaigns: [], deletedCampaign: { campaign, index: 0 } });
    first.close();
    const reload = await window.boot();
    await reload.save({ campaigns: [reload.deletedCampaign.campaign] });
    const blocked = await stale.save({ campaigns: [{ ...campaign, name: 'Stale after Undo' }] });
    const data = await window.readDB();
    reload.close();
    stale.close();
    return { blocked, data };
  });
  expect(result.blocked).toBe(false);
  expect(result.data.campaigns[0].value.future).toEqual({ retained: true });
  expect(result.data.recovery.find((row) => row.id === 'deleted').value).toBeNull();
});

test('active campaign identity survives reload when campaigns replay the same world', async ({
  page,
}) => {
  await prepare(page);
  await seed(page, [campaign, { ...campaign, id: 'imported-copy', name: 'Imported copy' }], {
    campaignId: campaign.id,
  });
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    const previous = store.preferences.campaignId;
    await store.save({ campaigns: store.campaigns, activeCampaignId: 'imported-copy' });
    store.close();
    const reload = await window.boot();
    const { findCampaignReplay } = await import('/src/application/campaigns.js');
    const replay = findCampaignReplay(reload.campaigns, {
      ...reload.campaigns[0],
      campaignId: reload.preferences.campaignId,
    });
    const result = { previous, active: reload.preferences.campaignId, found: replay.id };
    reload.close();
    return result;
  });
  expect(result).toEqual({
    previous: campaign.id,
    active: 'imported-copy',
    found: 'imported-copy',
  });
});

test('persistent storage refusal and API failures do not disable saving', async ({ page }) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const module = await import('/src/persistence/database.js');
    const store = await window.createStore({
      storageManager: { persisted: async () => false, persist: async () => false },
    });
    const saved = await store.save({ campaigns: [{ ...store.campaigns[0], name: 'Still saved' }] });
    const status = store.status();
    const states = await Promise.all([
      module.requestPersistence(undefined),
      module.requestPersistence({
        persist: async () => {
          throw new Error('Denied');
        },
      }),
      module.requestPersistence({
        persisted: async () => true,
        persist: async () => {
          throw new Error('Should not request again');
        },
      }),
    ]);
    store.close();
    return { saved, status, states };
  });
  expect(result.saved).toBe(true);
  expect(result.status.durability).toBe('denied');
  expect(result.states).toEqual(['unsupported', 'unavailable', 'granted']);
});

test('verified primary data works without localStorage; async abort and version changes are reported', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const initial = await window.boot();
    initial.close();
    const store = await window.createStore();
    const before = await window.readDB();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value) {
      const request = put.call(this, value);
      if (this.name === 'campaigns') this.transaction.abort();
      return request;
    };
    const aborted = await store.save({
      campaigns: [{ ...store.campaigns[0], name: 'Must roll back' }],
    });
    const after = await window.readDB();
    IDBObjectStore.prototype.put = put;
    const retried = await store.save({
      campaigns: [{ ...store.campaigns[0], name: 'Retry succeeded' }],
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('wilderness-almanac:campaigns', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const status = store.status();
    const blocked = await store.save({ campaigns: store.campaigns });
    store.close();
    return { before, after, aborted, retried, status, blocked };
  });
  expect(result.aborted).toBe(false);
  expect(result.after).toEqual(result.before);
  expect(result.retried).toBe(true);
  expect(result.status).toMatchObject({ reason: 'versionchange', readOnly: true });
  expect(result.blocked).toBe(false);
});

test('retry saving after deleting the last-opened campaign commits deletion and palette changes', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value) {
      if (
        this.transaction.db.name === 'wilderness-almanac:campaigns' &&
        sessionStorage.getItem('fail-save')
      )
        throw new DOMException('Full', 'QuotaExceededError');
      return put.call(this, value);
    };
  });
  const stored = () =>
    page.evaluate(async () => {
      const { openDatabase, readDatabase } = await import('/src/persistence/database.js');
      const db = await openDatabase(indexedDB);
      try {
        return await readDatabase(db);
      } finally {
        db.close();
      }
    });
  await prepare(page);
  await seed(page);
  await page.unroute('**/src/main.js');
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await page.locator('#hp-selection').selectOption('0,0');
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await expect
    .poll(async () => (await stored()).settings.find(({ id }) => id === 'activeCampaign')?.value)
    .toBe(campaign.id);
  await page.locator('#hp-back-menu').click();
  await expect(page.locator('#campaign-menu')).not.toHaveAttribute('inert');
  await page.evaluate(() => sessionStorage.setItem('fail-save', '1'));
  await page.getByRole('button', { name: 'Delete Test campaign', exact: true }).click();
  await page
    .locator('#delete-campaign-dialog')
    .getByRole('button', { name: 'Delete campaign', exact: true })
    .click();
  await expect(page.locator('#campaign-list .campaign-card')).toHaveCount(0);
  await expect(page.locator('#campaign-save-warning')).toBeVisible();
  expect((await stored()).campaigns).toHaveLength(1);
  await page.evaluate(() => sessionStorage.removeItem('fail-save'));
  await page.locator('#retry-campaign-save').click();
  await expect(page.locator('#campaign-save-warning')).toBeHidden();
  expect((await stored()).campaigns).toHaveLength(0);
  expect((await stored()).recovery.find(({ id }) => id === 'deleted')?.value.campaign.id).toBe(
    campaign.id,
  );

  // A later palette-only failure must also retry while the old map session
  // still refers to the deleted campaign.
  await page.locator('#open-settings').click();
  await page.locator('#open-palette-manager').click();
  await page.evaluate(() => sessionStorage.setItem('fail-save', '1'));
  await page.locator('#add-palette').click();
  await expect(page.locator('#palette-manager-message')).toContainText('aren’t saved');
  await page.locator('#close-palette-manager').click();
  await page.locator('#settings-cancel').click();
  await page.evaluate(() => sessionStorage.removeItem('fail-save'));
  await page.locator('#retry-campaign-save').click();
  await expect(page.locator('#campaign-save-warning')).toBeHidden();
  expect((await stored()).palettes).toHaveLength(1);
  expect((await stored()).campaigns).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#campaign-count')).toHaveText('0');
  await page.locator('#open-settings').click();
  await page.locator('#open-palette-manager').click();
  await expect(page.locator('.palette-row.is-custom')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the app reloads, reports failed saves and downloads unsaved changes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value) {
      if (this.name === 'campaigns' && sessionStorage.getItem('fail-save'))
        throw new DOMException('Full', 'QuotaExceededError');
      return put.call(this, value);
    };
  });
  await prepare(page);
  await seed(page, [campaign], { palettes: [palette], defaultPalette: palette.id });
  await page.unroute('**/src/main.js');
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await page.locator('#hp-selection').selectOption('0,0');
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await page.locator('#hp-back-menu').click();
  await page.reload();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await page.locator('#hp-selection').selectOption('0,0');
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await expect(page.getByRole('switch', { name: 'Visited', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.evaluate(() => sessionStorage.setItem('fail-save', '1'));
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await expect(page.locator('#hp-save-warning')).toBeVisible();
  const recoveryEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unsaved data', exact: true }).click();
  const recovery = JSON.parse(await readFile(await (await recoveryEvent).path(), 'utf8'));
  expect(recovery.unsaved.campaigns[0].hexEdits.cells['0,0'].visited).toBe(false);
  expect(recovery.unsaved.palettes.defaultPalette).toBe(palette.id);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download campaign', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(exported.campaign.hexEdits.cells['0,0'].visited).toBe(false);
  await page.evaluate(() => sessionStorage.removeItem('fail-save'));
  await page.locator('#hp-retry-save').click();
  await expect(page.locator('#hp-save-warning')).toBeHidden();
  await page.locator('#hp-back-menu').click();
  await page.reload();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await page.locator('#hp-selection').selectOption('0,0');
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await expect(page.getByRole('switch', { name: 'Visited', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const local = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(local[key]).toBeUndefined();
  expect(local[preferencesKey]).toBeUndefined();
  expect(Object.keys(JSON.parse(local['wilderness-almanac:ui-v1']))).not.toContain('palettes');
  expect(errors).toEqual([]);
});

test('fresh and simultaneous startup initialize once and ignore historical localStorage data', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('wilderness-almanac:campaigns-v1', '{untouched');
    const stores = await Promise.all([window.boot(), window.boot()]);
    const initial = await window.readDB();
    const status = stores.map((store) => store.status());
    stores.forEach((store) => store.close());
    const reopened = await window.boot();
    const after = await window.readDB();
    reopened.close();
    return {
      initial,
      after,
      status,
      source: localStorage.getItem('wilderness-almanac:campaigns-v1'),
    };
  });
  expect(result.initial).toEqual(result.after);
  expect(result.initial.campaigns).toEqual([]);
  expect(result.initial.settings.filter(({ id }) => id === 'library')).toHaveLength(1);
  expect(result.initial.settings.find(({ id }) => id === 'migration')).toBeUndefined();
  expect(result.status.every(({ readOnly }) => !readOnly)).toBe(true);
  expect(result.source).toBe('{untouched');
});

test('unsupported generators stay recoverable while current campaigns remain writable', async ({
  page,
}) => {
  await prepare(page);
  const unsupported = [6, 7, 8, 9, 11].map((generatorVersion) => ({
    ...campaign,
    id: `old-${generatorVersion}`,
    generatorVersion,
  }));
  await seed(page, [campaign, ...unsupported]);
  const result = await page.evaluate(async () => {
    const store = await window.boot();
    const before = store.status();
    const saved = await store.save({ campaigns: [{ ...store.campaigns[0], name: 'Current map' }] });
    const recovery = JSON.parse(await store.recovery());
    store.close();
    return { before, saved, recovery };
  });
  expect(result.before).toMatchObject({ preservedCount: 5, readOnly: false });
  expect(result.saved).toBe(true);
  for (const record of unsupported)
    expect(result.recovery.database.campaigns.find(({ id }) => id === record.id).value).toEqual(
      record,
    );
});

test('missing primary metadata blocks writes without initializing over existing records', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const { openDatabase, transact } = await import('/src/persistence/database.js');
    const db = await openDatabase(indexedDB);
    await transact(db, ['settings'], 'readwrite', ({ settings }) => settings.delete('library'));
    db.close();
    const store = await window.boot();
    const status = store.status();
    const saved = await store.save({ campaigns: [] });
    const recovery = JSON.parse(await store.recovery());
    store.close();
    return { status, saved, recovery };
  });
  expect(result.status).toMatchObject({ readOnly: true, reason: 'unreadable' });
  expect(result.saved).toBe(false);
  expect(result.recovery.database.campaigns[0].value).toEqual(campaign);
  expect(result.recovery.database.settings.find(({ id }) => id === 'library')).toBeUndefined();
});

test('unavailable IndexedDB reports failure and leaves old localStorage untouched', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('hex-sandbox:map-v1', 'original');
    const store = await window.createStore({
      indexedDB: {
        databases: async () => {
          throw new Error('Blocked');
        },
      },
    });
    const status = store.status();
    const saved = await store.save({ campaigns: [] });
    store.close();
    return { status, saved, original: localStorage.getItem('hex-sandbox:map-v1') };
  });
  expect(result.status).toMatchObject({ readOnly: true, reason: 'unavailable' });
  expect(result.saved).toBe(false);
  expect(result.original).toBe('original');
});
