import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { campaignWorld, campaignDressing } from '../src/generation/campaign-world.js';
import { validateHexEdits } from '../src/generation/hex-edits.js';
import { TERRAIN_TYPES } from '../src/generation/terrain-types.js';
import { TERRAIN_OPTIONS, terrainValue, terrainPatch } from '../src/ui/terrain-options.js';

const colors = ['#cdab8f', '#0b365e', '#11b329'];
const find = (cells, key) => cells.find((cell) => cell.key === key);
function fixture(generatorVersion = 10) {
  const world = generateWorld('vineyard-editor', { generatorVersion });
  const session = createCampaignSession({
    persist: () => ({ campaignSaved: true, preferencesSaved: true }),
  });
  session.open(createCampaign(world, colors, 'Forbidden Lands'), world);
  const cells = world.cells.filter((cell) => !cell.water && !cell.pointOfLight);
  session.select(cells[0].key);
  return { session, cells };
}
const crops = (state, key = state.selected) =>
  find(state.dressing.cells, key).props.filter((prop) => prop.kind === 'crops');
const farmland = (cropStyle) => ({
  terrain: 'farmlands',
  cropStyle,
  elevation: 0,
  settlement: null,
  poi: null,
  crossing: null,
});

test('terrain editors offer adjacent farmland appearances while world terrain stays unchanged', () => {
  assert.equal(TERRAIN_OPTIONS[TERRAIN_OPTIONS.indexOf('farmlands') + 1], 'vineyards');
  assert.ok(!TERRAIN_TYPES.includes('vineyards'));
  assert.deepEqual(terrainPatch('vineyards'), { terrain: 'farmlands', cropStyle: 'vineyard' });
  assert.deepEqual(terrainPatch('farmlands'), { terrain: 'farmlands', cropStyle: 'grain' });
  assert.equal(terrainValue({ terrain: 'farmlands' }, [{ cropStyle: 'vineyard' }]), 'vineyards');
  assert.equal(terrainValue({ terrain: 'meadow' }, [], 'vineyard'), 'meadow');
});

test('crop appearance imports are bounded and require version-4 farmland edits', () => {
  const edit = { terrain: 'farmlands', cropStyle: 'vineyard' };
  assert.equal(
    validateHexEdits({ version: 4, cells: { '0,0': edit } }).cells['0,0'].cropStyle,
    'vineyard',
  );
  for (const value of [
    { version: 3, cells: { '0,0': edit } },
    { version: 4, cells: { '0,0': { ...edit, cropStyle: 'invalid' } } },
    { version: 4, cells: { '0,0': { ...edit, terrain: 'meadow' } } },
    { version: 4, cells: { '0,0': { cropStyle: 'vineyard' } } },
    { version: 5, cells: {} },
  ])
    assert.throws(() => validateHexEdits(value), /invalid hex edits/);
});

for (const generatorVersion of [10]) {
  test(`manual farmland appearances save, replay and reroll on generator ${generatorVersion}`, () => {
    const { session } = fixture(generatorVersion);
    const initial = session.snapshot();
    assert.deepEqual(initial.dressing, generateDressing(initial.world));
    assert.equal(session.apply(farmland('vineyard')).ok, true);
    const vineyard = session.snapshot();
    assert.equal(find(vineyard.world.cells, vineyard.selected).terrain, 'farmlands');
    assert.ok(crops(vineyard).length);
    assert.ok(crops(vineyard).every((prop) => prop.cropStyle === 'vineyard'));
    const saved = importCampaign(exportCampaign(vineyard.campaign));
    assert.deepEqual(campaignDressing(saved, campaignWorld(saved)), vineyard.dressing);
    assert.equal(session.apply({ elevation: 1 }).ok, true);
    assert.equal(
      session.snapshot().campaign.hexEdits.cells[vineyard.selected].cropStyle,
      'vineyard',
    );
    assert.equal(session.undo().ok, true);
    assert.deepEqual(session.snapshot().campaign.hexEdits, vineyard.campaign.hexEdits);
    assert.equal(session.regenerateHex().ok, true);
    const rerolled = session.snapshot();
    assert.equal(rerolled.campaign.hexEdits.cells[rerolled.selected].cropStyle, undefined);
    assert.ok(crops(rerolled).every((prop) => prop.cropStyle !== 'vineyard'));
    assert.equal(session.undo().ok, true);
    assert.deepEqual(session.snapshot().dressing, vineyard.dressing);
    assert.equal(session.apply(farmland('grain')).ok, true);
    assert.ok(crops(session.snapshot()).every((prop) => prop.cropStyle === 'grain'));
    assert.equal(session.apply({ terrain: 'meadow' }).ok, true);
    assert.equal(
      session.snapshot().campaign.hexEdits.cells[vineyard.selected].cropStyle,
      undefined,
    );
  });
}

test('batch appearances are atomic, survive locks and release unlocked choices on map regeneration', () => {
  const { session, cells } = fixture();
  const first = cells[0].key,
    second = cells[1].key;
  const before = session.snapshot();
  session.setMultiEdit(true);
  session.select(second);
  assert.equal(session.applyBatch(farmland('vineyard')).ok, true);
  for (const key of [first, second])
    assert.ok(crops(session.snapshot(), key).every((p) => p.cropStyle === 'vineyard'));
  const batch = session.snapshot();
  assert.equal(session.undo().ok, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
  assert.equal(session.applyBatch(farmland('vineyard')).ok, true);
  session.setMultiEdit(false);
  session.select(first);
  assert.equal(session.lock().ok, true);
  const locked = session.snapshot();
  assert.equal(session.regenerate().ok, true);
  const regenerated = session.snapshot();
  assert.equal(regenerated.campaign.hexEdits.cells[first].cropStyle, 'vineyard');
  assert.equal(regenerated.campaign.hexEdits.cells[second].cropStyle, undefined);
  assert.deepEqual(
    find(regenerated.dressing.cells, first).props,
    find(locked.dressing.cells, first).props,
  );
  assert.equal(session.undo().ok, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits, locked.campaign.hexEdits);
  const writes = session.snapshot().campaign;
  session.setMultiEdit(true);
  session.select(second);
  assert.equal(session.applyBatch({ ...farmland('vineyard'), cropStyle: 'invalid' }).ok, false);
  assert.equal(session.snapshot().campaign, writes);
  assert.equal(batch.campaign.hexEdits.version, 4);
});

test('regeneration can turn an explicitly selected grain field into vineyards again', () => {
  const { session } = fixture();
  assert.equal(session.apply({ ...farmland('grain'), elevation: 1 }).ok, true);
  let vineyard = false;
  for (let variant = 1; variant <= 20 && !vineyard; variant++) {
    assert.equal(session.regenerate().ok, true);
    const state = session.snapshot();
    assert.equal(state.campaign.hexEdits.cells[state.selected].cropStyle, undefined);
    vineyard = crops(state).some((prop) => prop.cropStyle === 'vineyard');
    assert.equal(
      terrainValue(
        find(state.world.cells, state.selected),
        find(state.dressing.cells, state.selected).props,
      ),
      vineyard ? 'vineyards' : 'farmlands',
    );
  }
  assert.ok(vineyard, 'the normal cosmetic roll is free to choose vineyards again');
});
