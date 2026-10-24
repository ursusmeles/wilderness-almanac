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
    window.boot = () => window.createStore({ legacyStorage: localStorage });
  });
}

async function seed(page, campaigns = [campaign], preferences = {}) {
  await page.evaluate(
    ({ key, preferencesKey, campaigns, preferences }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, campaigns }));
      localStorage.setItem(preferencesKey, JSON.stringify({ version: 1, ...preferences }));
    },
    { key, preferencesKey, campaigns, preferences },
  );
}

test('migration preserves replay versions, party, visits, locks, palettes and unknown records', async ({
  page,
}) => {
  await prepare(page);
  const future = { ...campaign, id: 'future', generatorVersion: 999, future: ['keep'] };
  await seed(page, [campaign, future, { broken: true }, campaign], {
    palettes: [palette],
    defaultPalette: palette.id,
  });
  const result = await page.evaluate(
    async ({ key, preferencesKey, campaign }) => {
      const { generateWorld } = await import('/src/generation/world.js');
      const { lockHex, campaignDressing, campaignWorld } =
        await import('/src/generation/campaign-world.js');
      const base = generateWorld(campaign.seed, { generatorVersion: 6 });
      const locked = lockHex(
        {
          ...campaign,
          partyToken: {
            key: '0,0',
            style: 'warden',
            name: 'Party',
            daysTravelled: 3,
            sessionsPlayed: 2,
          },
        },
        '0,0',
        base,
        campaignDressing(campaign, base),
      );
      locked.hexEdits.cells['0,0'].visited = true;
      const raw = JSON.parse(localStorage.getItem(key));
      raw.campaigns[0] = { ...locked, futureField: { retain: true } };
      raw.extraLibraryField = 'retain';
      localStorage.setItem(key, JSON.stringify(raw));
      const original = localStorage.getItem(key);
      const store = await window.boot();
      const loaded = store.campaigns[0];
      const replay = JSON.stringify(campaignDressing(loaded, campaignWorld(loaded)));
      const expected = JSON.stringify(campaignDressing(locked, campaignWorld(locked)));
      await store.save({ campaigns: [{ ...loaded, name: 'Updated' }] });
      const recovery = JSON.parse(await store.recovery());
      store.close();
      const reloaded = await window.boot();
      const state = {
        campaigns: reloaded.campaigns,
        preferences: reloaded.preferences,
        status: reloaded.status(),
        retained: localStorage.getItem(key) === original,
        oldPrefs: localStorage.getItem(preferencesKey),
        recovery,
        replay: replay === expected,
      };
      reloaded.close();
      return state;
    },
    { key, preferencesKey, campaign },
  );
  expect(result.replay).toBe(true);
  expect(result.campaigns).toHaveLength(1);
  expect(result.campaigns[0]).toMatchObject({
    name: 'Updated',
    generatorVersion: 6,
    partyToken: { name: 'Party', daysTravelled: 3, sessionsPlayed: 2 },
    hexEdits: { cells: { '0,0': { visited: true, lock: {} } } },
  });
  expect(result.preferences).toMatchObject({ palettes: [palette], defaultPalette: palette.id });
  expect(result.retained).toBe(true);
  expect(result.oldPrefs).toBeNull();
  expect(result.status.preservedCount).toBe(3);
  expect(result.recovery.database.campaigns[0].value.futureField).toEqual({ retain: true });
  expect(
    JSON.parse(result.recovery.database.recovery.find((row) => row.id === key).source).campaigns[1],
  ).toEqual(future);
});

test('single-map migration and simultaneous startup are idempotent', async ({ page }) => {
  await prepare(page);
  await page.evaluate(
    ({ preferencesKey, palette }) =>
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          version: 1,
          seed: 'old-map',
          variant: 4,
          colors: palette.colors,
          palettes: [{ name: palette.name, colors: palette.colors }],
        }),
      ),
    { preferencesKey, palette },
  );
  const result = await page.evaluate(async () => {
    const stores = await Promise.all([window.boot(), window.boot()]);
    const result = {
      records: await window.readDB(),
      campaigns: stores.map((store) => store.campaigns),
      reasons: stores.map((store) => store.status().reason),
    };
    stores.forEach((store) => store.close());
    return result;
  });
  expect(result.reasons).toEqual([null, null]);
  expect(result.records.campaigns).toHaveLength(1);
  expect(result.campaigns[0]).toEqual(result.campaigns[1]);
  expect(result.campaigns[0][0]).toMatchObject({
    id: 'legacy-single-map',
    seed: 'old-map',
    variant: 4,
    generatorVersion: 6,
    colors: palette.colors,
  });
});

test('malformed envelopes and deletion data remain recoverable and read-only', async ({ page }) => {
  await prepare(page);
  for (const source of [
    '{broken',
    '{"version":99,"campaigns":[]}',
    JSON.stringify({ version: 1, campaigns: [campaign], deletedCampaign: { index: 0, campaign } }),
  ]) {
    const result = await page.evaluate(
      async ({ key, source, campaign }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('wilderness-almanac:campaigns');
          request.onsuccess = resolve;
          request.onerror = reject;
        });
        localStorage.setItem(key, source);
        const store = await window.boot();
        const saved = await store.save({ campaigns: [campaign] });
        const result = {
          saved,
          status: store.status(),
          retained: localStorage.getItem(key),
          recovery: await store.recovery(),
        };
        store.close();
        return result;
      },
      { key, source, campaign },
    );
    expect(result.saved).toBe(false);
    expect(result.status.readOnly).toBe(true);
    expect(result.retained).toBe(source);
    expect(JSON.parse(result.recovery).legacy[key]).toBe(source);
  }
});

test('failed migration commits nothing and retries safely from the untouched source', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(
    async ({ key }) => {
      const original = localStorage.getItem(key);
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value) {
        if (this.name === 'recovery') throw new DOMException('Full', 'QuotaExceededError');
        return put.call(this, value);
      };
      const failed = await window.boot();
      const before = await window.readDB();
      const retained = localStorage.getItem(key);
      failed.close();
      IDBObjectStore.prototype.put = put;
      const retry = await window.boot();
      const result = {
        reason: failed.status().reason,
        before,
        retained: retained === original,
        after: await window.readDB(),
        status: retry.status(),
        retired: localStorage.getItem(key),
      };
      retry.close();
      return result;
    },
    { key },
  );
  expect(result.retained).toBe(true);
  expect(result.before.campaigns).toEqual([]);
  expect(result.before.settings).toEqual([]);
  expect(result.after.campaigns).toHaveLength(1);
  expect(result.status.reason).toBeNull();
  expect(result.retired).toBeNull();
});

test('read-back validation failure preserves sources; interrupted cleanup never overwrites newer saves', async ({
  page,
}) => {
  await prepare(page);
  await seed(page, [campaign], { palettes: [palette], defaultPalette: palette.id });
  const result = await page.evaluate(
    async ({ key, palette }) => {
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        const request = getAll.apply(this, args);
        if (this.name === 'campaigns')
          request.addEventListener('success', () => {
            if (request.result[0]) request.result[0].value.seed = 'damaged readback';
          });
        return request;
      };
      const failed = await window.boot();
      const retained = localStorage.getItem(key) !== null;
      failed.close();
      IDBObjectStore.prototype.getAll = getAll;
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function () {
        throw new Error('Interrupted cleanup');
      };
      const retry = await window.boot();
      await retry.save({
        campaigns: [{ ...retry.campaigns[0], name: 'Newer save' }],
        palettes: { palettes: [palette], defaultPalette: palette.id },
      });
      retry.close();
      Storage.prototype.removeItem = remove;
      const reload = await window.boot();
      const result = {
        retained,
        campaigns: reload.campaigns,
        retired: localStorage.getItem(key),
        rows: (await window.readDB()).campaigns.length,
      };
      reload.close();
      return result;
    },
    { key, palette },
  );
  expect(result.retained).toBe(true);
  expect(result.retired).toBeNull();
  expect(result.rows).toBe(1);
  expect(result.campaigns[0].name).toBe('Newer save');
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

test('unreadable legacy palette preferences remain visible in recovery and unchanged at their key', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(
    async ({ preferencesKey }) => {
      const source = JSON.stringify({
        version: 1,
        palettes: [{ name: 'Damaged palette', colors: ['invalid'] }],
        defaultPalette: 'custom:future',
      });
      localStorage.setItem(preferencesKey, source);
      const store = await window.boot();
      const success = await store.save({
        campaigns: [{ ...store.campaigns[0], name: 'Still editable' }],
      });
      const result = {
        status: store.status(),
        source,
        retained: localStorage.getItem(preferencesKey),
        recovery: JSON.parse(await store.recovery()),
        success,
      };
      store.close();
      return result;
    },
    { preferencesKey },
  );
  expect(result.success).toBe(true);
  expect(result.status.preservedPreferences).toBe(true);
  expect(result.retained).toBe(result.source);
  expect(result.recovery.database.recovery.find((row) => row.id === preferencesKey).source).toBe(
    result.source,
  );
});

test('persistent storage refusal and API failures do not disable saving', async ({ page }) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const module = await import('/src/persistence/database.js');
    const store = await window.createStore({
      legacyStorage: localStorage,
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

test('unavailable IndexedDB preserves legacy downloads, and changed legacy sources block overwrites', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(
    async ({ key }) => {
      const original = localStorage.getItem(key);
      const unavailable = await window.createStore({
        legacyStorage: localStorage,
        indexedDB: {
          open() {
            throw new DOMException('Blocked', 'SecurityError');
          },
        },
      });
      const failed = await unavailable.save({ campaigns: unavailable.campaigns });
      const recovery = JSON.parse(await unavailable.recovery());
      unavailable.close();
      const migrated = await window.boot();
      await migrated.save({ campaigns: [{ ...migrated.campaigns[0], name: 'Primary save' }] });
      migrated.close();
      const changed = JSON.parse(original);
      changed.campaigns[0].name = 'Older app changed this';
      localStorage.setItem(key, JSON.stringify(changed));
      const conflict = await window.boot();
      const blocked = await conflict.save({ campaigns: conflict.campaigns });
      const result = {
        failed,
        recovery,
        original,
        blocked,
        status: conflict.status(),
        data: await window.readDB(),
        legacy: localStorage.getItem(key),
      };
      conflict.close();
      return result;
    },
    { key },
  );
  expect(result.failed).toBe(false);
  expect(result.recovery.legacy[key]).toBe(result.original);
  expect(result.blocked).toBe(false);
  expect(result.status.reason).toBe('conflict');
  expect(result.data.campaigns[0].value.name).toBe('Primary save');
  expect(JSON.parse(result.legacy).campaigns[0].name).toBe('Older app changed this');
});

test('verified primary data works without localStorage; async abort and version changes are reported', async ({
  page,
}) => {
  await prepare(page);
  await seed(page);
  const result = await page.evaluate(async () => {
    const initial = await window.boot();
    initial.close();
    const store = await window.createStore({
      legacyStorage: {
        getItem() {
          throw new Error('Blocked');
        },
      },
    });
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
  await page.addInitScript(
    ({ campaign, key }) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, JSON.stringify({ version: 1, campaigns: [campaign] }));
        sessionStorage.setItem('seeded', '1');
      }
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value) {
        if (
          this.transaction.db.name === 'wilderness-almanac:campaigns' &&
          sessionStorage.getItem('fail-save')
        )
          throw new DOMException('Full', 'QuotaExceededError');
        return put.call(this, value);
      };
    },
    { campaign, key },
  );
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
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
  await page.locator('#open-palette-manager').click();
  await page.evaluate(() => sessionStorage.setItem('fail-save', '1'));
  await page.locator('#add-palette').click();
  await expect(page.locator('#palette-manager-message')).toContainText('aren’t saved');
  await page.locator('#close-palette-manager').click();
  await page.evaluate(() => sessionStorage.removeItem('fail-save'));
  await page.locator('#retry-campaign-save').click();
  await expect(page.locator('#campaign-save-warning')).toBeHidden();
  expect((await stored()).palettes).toHaveLength(1);
  expect((await stored()).campaigns).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#campaign-count')).toHaveText('0');
  await page.locator('#open-palette-manager').click();
  await expect(page.locator('.palette-row.is-custom')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the app migrates, reloads, reports failed saves and downloads unsaved changes', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ campaign, palette, key, preferencesKey }) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, JSON.stringify({ version: 1, campaigns: [campaign] }));
        localStorage.setItem(
          preferencesKey,
          JSON.stringify({ version: 1, palettes: [palette], defaultPalette: palette.id }),
        );
        sessionStorage.setItem('seeded', '1');
      }
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value) {
        if (this.name === 'campaigns' && sessionStorage.getItem('fail-save'))
          throw new DOMException('Full', 'QuotaExceededError');
        return put.call(this, value);
      };
    },
    { campaign, palette, key, preferencesKey },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await page.locator('#hp-back-menu').click();
  await page.reload();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
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
