import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignStore } from '../src/ui/campaign-store.js';
import { GENERATOR_VERSION } from '../src/generation/world.js';

const campaign = {
  id: 'supported',
  name: 'Supported world',
  seed: '7',
  generatorVersion: GENERATOR_VERSION,
  variant: 0,
  createdAt: '2026-10-20T12:00:00.000Z',
  paletteName: 'Forbidden Lands',
  colors: ['#cdab8f', '#0b365e', '#11b329'],
};
function fixture(source = null) {
  let raw = source;
  let blocked = false;
  const storage = {
    getItem: () => raw,
    setItem: (_key, value) => {
      if (blocked) throw new Error('Quota exceeded');
      raw = value;
    },
  };
  return {
    storage,
    raw: () => raw,
    block: (value) => {
      blocked = value;
    },
    replace: (value) => {
      raw = value;
    },
    load: () => createCampaignStore(storage),
  };
}
const library = (campaigns, extras = {}) => JSON.stringify({ version: 1, campaigns, ...extras });

test('unreadable campaigns survive edits, deletion, creation and another reload unchanged', () => {
  const future = {
    ...campaign,
    id: 'future',
    generatorVersion: GENERATOR_VERSION + 1,
    futureData: { notes: ['keep me'] },
  };
  const damaged = { ...campaign, id: 'damaged', hexEdits: { version: 999, cells: {} } };
  const f = fixture(
    library([future, campaign, damaged, null], { extraLibraryData: { keep: true } }),
  );
  const store = f.load();
  assert.deepEqual(store.campaigns, [campaign]);
  assert.equal(store.status().preservedCount, 3);
  assert.equal(store.save([{ ...campaign, name: 'Renamed' }]), true);
  assert.equal(store.save([], { campaign, index: 0 }), true);
  assert.equal(store.save([{ ...campaign, id: 'new' }]), true);
  const saved = JSON.parse(f.raw());
  assert.deepEqual(saved.campaigns.slice(1), [future, damaged, null]);
  assert.deepEqual(saved.extraLibraryData, { keep: true });
  assert.equal(f.load().status().preservedCount, 3);
  assert.deepEqual(store.recovery(), f.raw());
});

test('a library containing only unsupported campaigns is not a first-run library', () => {
  const raw = library([{ ...campaign, generatorVersion: GENERATOR_VERSION - 1 }]);
  const store = fixture(raw).load();
  assert.equal(store.missing, false);
  assert.deepEqual(store.campaigns, []);
  assert.equal(store.status().preservedCount, 1);
  assert.equal(store.recovery(), raw);
});

test('malformed and unsupported library envelopes stay byte-for-byte intact', () => {
  for (const raw of [
    '',
    '{broken',
    'null',
    library([], { version: 2 }),
    '{"version":1,"campaigns":null}',
  ]) {
    const f = fixture(raw),
      store = f.load();
    assert.equal(store.missing, false);
    assert.equal(store.status().reason, 'unreadable');
    assert.equal(store.status().hasRecovery, true);
    assert.equal(store.save([campaign]), false);
    assert.equal(f.raw(), raw);
    assert.equal(store.recovery(), raw);
  }
});

test('an unreadable deleted campaign also protects the original library', () => {
  const raw = library([campaign], {
    deletedCampaign: { index: 0, campaign: { ...campaign, generatorVersion: 99 } },
  });
  const f = fixture(raw),
    store = f.load();
  assert.deepEqual(store.campaigns, [campaign]);
  assert.equal(store.status().reason, 'unreadable');
  assert.equal(store.save([]), false);
  assert.equal(store.recovery(), raw);
  assert.equal(f.raw(), raw);
});

test('quota failures preserve the saved copy and a later successful retry clears the error', () => {
  const raw = library([campaign]);
  const f = fixture(raw),
    store = f.load();
  f.block(true);
  assert.equal(store.save([{ ...campaign, name: 'Unsaved changes' }]), false);
  assert.equal(f.raw(), raw);
  assert.equal(store.status().reason, 'unavailable');
  f.block(false);
  assert.equal(store.save([{ ...campaign, name: 'Unsaved changes' }]), true);
  assert.equal(store.status().reason, null);
  assert.equal(f.load().campaigns[0].name, 'Unsaved changes');
});

test('unavailable reads never lead to a blind overwrite', () => {
  let writes = 0;
  const store = createCampaignStore({
    getItem() {
      throw new Error('Blocked');
    },
    setItem() {
      writes++;
    },
  });
  assert.equal(store.status().reason, 'unavailable');
  assert.equal(store.missing, false);
  assert.equal(store.save([campaign]), false);
  assert.equal(writes, 0);
});

test('a second tab cannot overwrite a newer library with its stale snapshot', () => {
  const f = fixture(library([campaign]));
  const first = f.load(),
    second = f.load();
  assert.equal(first.save([{ ...campaign, name: 'Newer changes' }]), true);
  const newer = f.raw();
  assert.equal(second.save([{ ...campaign, name: 'Stale changes' }]), false);
  assert.equal(second.status().reason, 'conflict');
  assert.equal(f.raw(), newer);
});

test('duplicate IDs are retained for recovery without ambiguous editable campaign cards', () => {
  const duplicate = { ...campaign, name: 'Another campaign with the same ID' };
  const f = fixture(library([campaign, duplicate]));
  const store = f.load();
  assert.deepEqual(store.campaigns, [campaign]);
  assert.equal(store.save([]), true);
  assert.deepEqual(JSON.parse(f.raw()).campaigns, [duplicate]);
});

test('unknown local campaign fields survive writes without reviving edits removed by New Map', () => {
  const stored = {
    ...campaign,
    futureTrackerData: { notes: ['retain this field'] },
    hexEdits: { version: 1, cells: { '0,0': { visited: true } } },
  };
  const f = fixture(library([stored]));
  const store = f.load();
  const { hexEdits, ...replacement } = store.campaigns[0];
  assert.equal(store.save([{ ...replacement, seed: 'replacement world' }]), true);
  const record = JSON.parse(f.raw()).campaigns[0];
  assert.deepEqual(record.futureTrackerData, stored.futureTrackerData);
  assert.equal(Object.hasOwn(record, 'hexEdits'), false);
  assert.equal(store.save([], { campaign: replacement, index: 0 }), true);
  assert.deepEqual(
    JSON.parse(f.raw()).deletedCampaign.campaign.futureTrackerData,
    stored.futureTrackerData,
  );
  const reload = f.load();
  assert.equal(reload.save([reload.deletedCampaign.campaign]), true);
  assert.deepEqual(JSON.parse(f.raw()).campaigns[0].futureTrackerData, stored.futureTrackerData);
});

test('ambiguous deletion records are preserved, and invalid new deletion data cannot replace a good save', () => {
  const raw = library([campaign], { deletedCampaign: { campaign, index: 0 } });
  const f = fixture(raw);
  assert.equal(f.load().status().reason, 'unreadable');
  assert.equal(f.load().save([]), false);
  assert.equal(f.raw(), raw);
  const healthy = fixture(library([campaign]));
  assert.equal(healthy.load().save([], 0), false);
  assert.deepEqual(JSON.parse(healthy.raw()).campaigns, [campaign]);
});
