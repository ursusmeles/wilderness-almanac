import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/generation/world.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { campaignWorld, campaignDressing, updateHexes } from '../src/generation/campaign-world.js';
import { settlementJoin } from '../src/generation/settlement-edits.js';
import { validateHexEdits } from '../src/generation/hex-edits.js';
import { hexAddress } from '../src/generation/hex.js';

const base = generateWorld('7');
const campaign = createCampaign(base, ['#cdab8f', '#0b365e', '#11b329'], 'Forbidden Lands');
const keys = ['0,0', '1,0', '2,0'];
function fixture(type) {
  const writes = [];
  const record = updateHexes(
    campaign,
    Object.fromEntries(
      keys.map((key) => [
        key,
        {
          terrain: 'meadow',
          elevation: 1,
          settlement: type,
          poi: null,
          crossing: null,
        },
      ]),
    ),
  );
  const session = createCampaignSession({
    persist(record) {
      writes.push(record);
      return { campaignSaved: true, preferencesSaved: true };
    },
  });
  session.open(record, base);
  session.select(keys[0]);
  session.setMultiEdit(true);
  session.select(keys[1]);
  return { session, writes };
}
const cell = (world, key) => world.cells.find((cell) => cell.key === key);

for (const type of ['town', 'city'])
  test(`connected ${type} tiles join atomically, replay, relock and undo`, () => {
    const { session, writes } = fixture(type);
    session.setMultiEdit(false);
    session.select(keys[0]);
    session.lock();
    session.setMultiEdit(true);
    session.select(keys[1]);
    const before = session.snapshot();
    const count = writes.length;
    assert.equal(before.join.type, type);
    assert.equal(session.joinSelection().ok, true);
    const after = session.snapshot();
    const first = cell(after.world, keys[0]);
    assert.equal(first.pointOfLight.id, cell(after.world, keys[1]).pointOfLight.id);
    assert.equal(first.pointOfLight.size, 2);
    assert.notEqual(first.pointOfLight.id, cell(after.world, keys[2]).pointOfLight.id);
    assert.equal(after.join.joined, true);
    assert.equal(writes.length, count + 1);
    assert.ok(after.campaign.hexEdits.cells[keys[0]].lock);
    assert.equal(after.campaign.hexEdits.version, 2);
    const replay = importCampaign(exportCampaign(after.campaign));
    assert.deepEqual(campaignWorld(replay), after.world);
    assert.deepEqual(
      campaignDressing(replay, campaignWorld(replay)).cells.map((cell) => cell.props),
      after.dressing.cells.map((cell) => cell.props),
    );
    assert.equal(session.joinSelection().ok, false);
    assert.equal(writes.length, count + 1);
    session.undo();
    assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
  });

test('join eligibility excludes villages, gaps, mixed types and single hexes', () => {
  const { session, writes } = fixture('village');
  assert.equal(session.snapshot().join, null);
  assert.equal(session.joinSelection().ok, false);
  assert.equal(writes.length, 1);
  for (const key of keys) assert.equal(cell(session.snapshot().world, key).pointOfLight.size, 1);
  const { session: towns } = fixture('town');
  const world = towns.snapshot().world;
  assert.equal(settlementJoin(world, [keys[0]]), null);
  assert.equal(settlementJoin(world, [keys[0], keys[2]]), null);
  towns.clearSelection();
  towns.select(keys[1]);
  towns.applyBatch({ settlement: 'city' });
  towns.select(keys[0]);
  assert.equal(towns.snapshot().join, null);
});

test('joining part of an existing city detaches just that selection, even with the same anchor', () => {
  const { session } = fixture('city');
  session.select(keys[2]);
  assert.equal(session.joinSelection().ok, true);
  const before = session.snapshot();
  session.select(keys[2]);
  assert.equal(session.snapshot().join.joined, false);
  assert.equal(session.joinSelection().ok, true);
  const after = session.snapshot().world;
  assert.equal(cell(after, keys[0]).pointOfLight.size, 2);
  assert.equal(cell(after, keys[2]).pointOfLight.size, 1);
  assert.notEqual(cell(after, keys[0]).pointOfLight.id, cell(after, keys[2]).pointOfLight.id);
  session.undo();
  assert.deepEqual(session.snapshot().world, before.world);
});

test('converting a joined footprint to villages creates independent single-hex villages', () => {
  const { session } = fixture('city');
  session.select(keys[2]);
  session.joinSelection();
  assert.equal(session.applyBatch({ settlement: 'village' }).ok, true);
  const after = session.snapshot();
  assert.equal(new Set(keys.map((key) => cell(after.world, key).pointOfLight.id)).size, 3);
  for (const key of keys) {
    assert.equal(cell(after.world, key).pointOfLight.size, 1);
    assert.equal(after.campaign.hexEdits.cells[key].settlementGroup, undefined);
  }
  assert.deepEqual(campaignWorld(importCampaign(exportCampaign(after.campaign))), after.world);
});

test('group imports validate version, bounded group keys, revisions and settlement types', () => {
  for (const [version, edit] of [
    [1, { settlement: 'town', settlementGroup: '0,0/1' }],
    [2, { settlement: 'village', settlementGroup: '0,0/1' }],
    [2, { settlementGroup: '0,0/1' }],
    [2, { settlement: 'city', settlementGroup: '99,99/1' }],
    [2, { settlement: 'city', settlementGroup: '0,0/0' }],
    [2, { settlement: 'city', settlementGroup: '0,0/1000000' }],
    [2, { settlement: 'city', settlementGroup: {} }],
  ])
    assert.throws(() => validateHexEdits({ version, cells: { '0,0': edit } }), /invalid hex/);
  assert.throws(
    () =>
      validateHexEdits({
        version: 2,
        cells: {
          '0,0': { settlement: 'town', settlementGroup: '0,0/1' },
          '1,0': { settlement: 'city', settlementGroup: '0,0/1' },
        },
      }),
    /invalid hex/,
  );
});

test('validation errors identify the region and local coordinates', () => {
  const { session } = fixture('town');
  const ocean = base.cells.find((cell) => cell.water === 'ocean');
  session.clearSelection();
  session.select(ocean.key);
  const result = session.applyBatch({ settlement: 'village' });
  assert.equal(result.ok, false);
  assert.ok(result.error.startsWith(`${hexAddress(ocean)}:`));
  assert.match(result.error, /Choose land terrain first/);
});
