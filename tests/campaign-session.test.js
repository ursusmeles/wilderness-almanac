import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { generateWorld } from '../src/generation/world.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { campaignWorld, campaignDressing } from '../src/generation/campaign-world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { components, neighbours } from '../src/generation/hex.js';

const campaign = createCampaign(
  generateWorld('7'),
  ['#cdab8f', '#0b365e', '#11b329'],
  'Forbidden Lands',
);
function fixture() {
  const writes = [];
  let outcome = { campaignSaved: true, preferencesSaved: true };
  const session = createCampaignSession({
    persist(record) {
      writes.push(record);
      return outcome;
    },
  });
  session.open(campaign);
  session.select('0,0');
  return {
    session,
    writes,
    fail: (value) => {
      outcome = value;
    },
  };
}

test('time of day is saved per campaign without changing geometry or Undo history', () => {
  const { session, writes, fail } = fixture();
  const initial = session.snapshot(),
    count = writes.length;
  assert.equal(session.setTimeOfDay('night').ok, true);
  assert.equal(writes.length, count + 1);
  assert.equal(writes.at(-1).timeOfDay, 'night');
  assert.equal(session.snapshot().world, initial.world);
  assert.equal(session.snapshot().dressing, initial.dressing);
  assert.equal(session.snapshot().canUndo, false);
  session.visit();
  session.setTimeOfDay('dusk');
  session.undo();
  assert.equal(session.snapshot().campaign.timeOfDay, 'dusk');
  const saved = importCampaign(exportCampaign(writes.at(-1)));
  session.open(campaign);
  assert.equal(session.snapshot().campaign.timeOfDay, 'day');
  session.open(saved);
  assert.equal(session.snapshot().campaign.timeOfDay, 'dusk');
  const invalidWrites = writes.length;
  assert.equal(session.setTimeOfDay('invalid').ok, false);
  assert.equal(writes.length, invalidWrites);
  fail({ campaignSaved: false, preferencesSaved: true });
  session.setTimeOfDay('dawn');
  assert.equal(session.snapshot().campaign.timeOfDay, 'dawn');
  assert.equal(session.snapshot().persistence.saved, false);
});

test('asynchronous saves retain live edits and ignore older completion results', async () => {
  const completions = [];
  const session = createCampaignSession({
    persist: () => new Promise((resolve, reject) => completions.push({ resolve, reject })),
  });
  session.open(campaign);
  assert.equal(session.snapshot().persistence.pending, true);
  session.visit();
  completions[1].resolve({ campaignSaved: true, preferencesSaved: true });
  await Promise.resolve();
  completions[0].resolve({ campaignSaved: false, preferencesSaved: false });
  await Promise.resolve();
  assert.equal(session.snapshot().persistence.saved, true);
  const edited = session.snapshot().campaign;
  const saved = session.save();
  completions[2].reject(new Error('Blocked browser storage'));
  assert.equal((await saved).saved, false);
  assert.equal(session.snapshot().campaign, edited);
  assert.equal(session.snapshot().canUndo, true);
});

test('multi selection toggles, selects all and clears without persisting or adding history', () => {
  const { session, writes } = fixture();
  session.setMultiEdit(true);
  assert.deepEqual(session.snapshot().selectedKeys, ['0,0']);
  session.select('1,0');
  session.select('0,0');
  assert.deepEqual(session.snapshot().selectedKeys, ['1,0']);
  assert.equal(session.select('99,99'), false);
  session.selectAll();
  assert.equal(session.snapshot().selectedKeys.length, 469);
  session.clearSelection();
  assert.deepEqual(session.snapshot().selectedKeys, []);
  assert.equal(session.applyBatch({ terrain: 'meadow' }).ok, false);
  assert.equal(session.snapshot().canUndo, false);
  assert.equal(writes.length, 1);
  session.open(campaign);
  assert.equal(session.snapshot().multiEdit, false);
});

test('a batch preserves omitted fields, exports/replays and undoes with one history entry and save', () => {
  const { session, writes } = fixture();
  session.visit();
  const before = session.snapshot();
  session.setMultiEdit(true);
  session.select('1,0');
  const writeCount = writes.length;
  assert.equal(session.applyBatch({ terrain: 'meadow', elevation: 1 }).ok, true);
  const after = session.snapshot();
  for (const key of ['0,0', '1,0']) {
    const cell = after.world.cells.find((cell) => cell.key === key);
    assert.equal(cell.terrain, 'meadow');
    assert.equal(cell.elevation, 1);
    assert.deepEqual(
      cell.pointOfLight,
      before.world.cells.find((cell) => cell.key === key).pointOfLight,
    );
  }
  assert.equal(after.campaign.hexEdits.cells['0,0'].visited, true);
  assert.equal(writes.length, writeCount + 1);
  const imported = importCampaign(exportCampaign(after.campaign));
  assert.deepEqual(campaignWorld(imported), after.world);
  assert.deepEqual(campaignDressing(imported, campaignWorld(imported)), after.dressing);
  assert.equal(session.undo().ok, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
  assert.equal(session.undo().ok, true);
  assert.equal(session.snapshot().canUndo, false);
});

test('one incompatible target rejects the whole batch without a save or Undo entry', () => {
  const { session, writes } = fixture();
  const initial = session.snapshot();
  const land = initial.world.cells.find((cell) => !cell.water);
  const ocean = initial.world.cells.find((cell) => cell.water === 'ocean');
  session.select(land.key);
  session.setMultiEdit(true);
  session.select(ocean.key);
  assert.match(session.applyBatch({ settlement: 'village' }).error, /Water cannot/);
  assert.match(session.applyBatch({ elevation: 2 }).error, /fixed elevation/);
  assert.equal(session.snapshot().campaign, initial.campaign);
  assert.equal(session.snapshot().world, initial.world);
  assert.equal(session.snapshot().canUndo, false);
  assert.equal(writes.length, 1);
});

test('crossing requests reject any non-river target even when the last clicked hex is valid', () => {
  const { session, writes } = fixture();
  const world = session.snapshot().world;
  const invalid = world.cells.find((cell) => !cell.water);
  const valid = world.cells.find((cell) => cell.crossing);
  session.select(invalid.key);
  const initial = session.snapshot();
  const writeCount = writes.length;
  session.setMultiEdit(true);
  session.select(valid.key);
  assert.match(session.applyBatch({ crossing: 'bridge' }).error, /only be placed on rivers/);
  assert.equal(session.snapshot().campaign, initial.campaign);
  assert.equal(writes.length, writeCount);
});

test('batch water conversion removes incompatible overrides and relocks edited dressing', () => {
  const { session } = fixture();
  for (const key of ['0,0', '1,0']) {
    session.select(key);
    assert.equal(
      session.apply({ terrain: 'meadow', settlement: 'village', poi: null, crossing: null }).ok,
      true,
    );
    session.visit();
    session.lock();
  }
  const before = session.snapshot();
  session.setMultiEdit(true);
  session.select('0,0');
  assert.equal(session.applyBatch({ terrain: 'open water' }).ok, true);
  for (const key of ['0,0', '1,0']) {
    const state = session.snapshot();
    const cell = state.world.cells.find((cell) => cell.key === key);
    assert.equal(cell.elevation, 0);
    assert.equal(cell.pointOfLight, undefined);
    assert.deepEqual(cell.pointsOfInterest, []);
    assert.equal(state.campaign.hexEdits.cells[key].visited, true);
    assert.ok(state.campaign.hexEdits.cells[key].lock.props.every((prop) => prop.kind === 'wave'));
  }
  session.undo();
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
});

test('batch tracking shares geometry and failed saving retains the complete batch', () => {
  const { session, fail } = fixture();
  const before = session.snapshot();
  session.setMultiEdit(true);
  session.select('1,0');
  fail({ campaignSaved: false, preferencesSaved: true });
  assert.equal(session.applyBatch({ visited: true }).ok, true);
  const after = session.snapshot();
  assert.equal(after.world, before.world);
  assert.equal(after.dressing, before.dressing);
  assert.equal(after.campaign.hexEdits.cells['0,0'].visited, true);
  assert.equal(after.campaign.hexEdits.cells['1,0'].visited, true);
  assert.equal(after.persistence.saved, false);
  session.undo();
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
});

test('whole-map terrain conversion uses existing replay format and has finite geometry', () => {
  const { session } = fixture();
  const before = session.snapshot();
  session.setMultiEdit(true);
  session.selectAll();
  assert.equal(
    session.applyBatch({ terrain: 'meadow', elevation: 0, settlement: null, poi: null }).ok,
    true,
  );
  const after = session.snapshot();
  assert.equal(after.world.terrain.counts.meadow, 469);
  assert.equal(after.world.settlements.length, 0);
  const layout = prepareMap(after.world, after.dressing);
  assert.equal(layout.length, 469);
  assert.ok(layout.every((cell) => Number.isFinite(cell.top)));
  assert.deepEqual(campaignWorld(importCampaign(exportCampaign(after.campaign))), after.world);
  assert.equal(session.undo().ok, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
});

test('batch result is independent of selection order, including repaired river links', () => {
  const left = fixture().session;
  const right = fixture().session;
  const keys = ['0,0', '1,0', '0,1'];
  for (const [session, order] of [
    [left, keys],
    [right, keys.toReversed()],
  ]) {
    session.setMultiEdit(true);
    session.clearSelection();
    for (const key of order) session.select(key);
    assert.equal(session.applyBatch({ terrain: 'river', poi: null, crossing: null }).ok, true);
  }
  assert.deepEqual(left.snapshot().world, right.snapshot().world);
  assert.deepEqual(left.snapshot().dressing, right.snapshot().dressing);
});

test('batch snapshot invalidation includes every affected forest component', () => {
  const { session } = fixture();
  const world = session.snapshot().world;
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const groups = components(
    world.cells.filter((cell) => cell.terrain.includes('forest')),
    byKey,
  )
    .filter((group) => group.length > 1)
    .slice(0, 2);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    session.select(group[0].key);
    assert.equal(session.regenerateHex().ok, true);
  }
  const before = session.snapshot().campaign;
  session.setMultiEdit(true);
  session.clearSelection();
  for (const group of groups) {
    const target = neighbours(group[0], byKey).find((cell) => group.includes(cell));
    session.select(target.key);
  }
  assert.equal(session.applyBatch({ terrain: 'meadow' }).ok, true);
  for (const group of groups) {
    assert.ok(before.hexEdits.cells[group[0].key].dressing);
    assert.equal(session.snapshot().campaign.hexEdits.cells[group[0].key].dressing, undefined);
  }
  session.undo();
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.hexEdits);
});

test('tracking and lock actions share world/dressing, retain immutable undo state and persist results', () => {
  const { session, writes } = fixture();
  const initial = session.snapshot();
  assert.equal(session.visit().ok, true);
  assert.equal(session.snapshot().world, initial.world);
  assert.equal(session.snapshot().dressing, initial.dressing);
  assert.deepEqual(initial.campaign.hexEdits.cells, {
    [initial.campaign.partyToken.key]: { visited: true },
  });
  assert.equal(session.snapshot().campaign.hexEdits.cells['0,0'].visited, true);
  assert.equal(session.lock().ok, true);
  assert.ok(session.snapshot().campaign.hexEdits.cells['0,0'].lock);
  assert.equal(session.undo().ok, true);
  assert.equal(session.snapshot().campaign.hexEdits.cells['0,0'].lock, undefined);
  assert.equal(writes.length, 4);
  assert.equal(session.snapshot().persistence.saved, true);
});

test('failed validation leaves campaign, history and persisted state untouched', () => {
  const { session, writes } = fixture();
  const before = session.snapshot();
  const invalid = session.apply({ terrain: 'not a terrain' });
  assert.equal(invalid.ok, false);
  assert.equal(session.snapshot().campaign, before.campaign);
  assert.equal(session.snapshot().world, before.world);
  assert.equal(session.snapshot().canUndo, false);
  assert.equal(writes.length, 1);
});

test('storage failure retains in-memory edits and reports independent persistence results', () => {
  const { session, fail } = fixture();
  fail({ campaignSaved: false, preferencesSaved: true });
  assert.equal(session.visit().ok, true);
  assert.equal(session.snapshot().campaign.hexEdits.cells['0,0'].visited, true);
  assert.deepEqual(session.snapshot().persistence, {
    campaignSaved: false,
    preferencesSaved: true,
    pending: false,
    saved: false,
  });
  fail({ campaignSaved: true, preferencesSaved: true });
  assert.equal(session.save().saved, true);
});

test('an unexpected persistence exception cannot turn an applied action into a discarded edit', () => {
  const session = createCampaignSession({
    persist() {
      throw new Error('Blocked storage');
    },
  });
  session.open(campaign);
  session.select('0,0');
  assert.equal(session.visit().ok, true);
  assert.equal(session.snapshot().campaign.hexEdits.cells['0,0'].visited, true);
  assert.equal(session.snapshot().persistence.saved, false);
});

test('undo is bounded, keeps later palettes and resets when another campaign is opened', () => {
  const { session } = fixture();
  for (let i = 0; i < 25; i++) session.visit();
  session.palette(['#282039', '#237d89', '#e5b96e'], 'Dusk & gold');
  for (let i = 0; i < 20; i++) assert.equal(session.undo().ok, true);
  assert.equal(session.undo().ok, false);
  assert.equal(session.snapshot().campaign.paletteName, 'Dusk & gold');
  session.visit();
  session.open({ ...campaign, id: 'another' });
  assert.equal(session.snapshot().canUndo, false);
});

test('replacement requires confirmation, keeps campaign identity and renamed names, and clears edit history', () => {
  const { session } = fixture();
  session.open({ ...campaign, name: 'My world', nameEdited: true });
  session.visit();
  const current = session.snapshot();
  assert.equal(session.replace('replacement').requiresConfirmation, true);
  assert.equal(session.snapshot().campaign, current.campaign);
  assert.equal(session.replace('replacement', { confirmed: true }).ok, true);
  const next = session.snapshot();
  assert.equal(next.campaign.id, current.campaign.id);
  assert.equal(next.campaign.name, 'My world');
  assert.equal(next.campaign.createdAt, current.campaign.createdAt);
  assert.equal(next.campaign.seed, 'replacement');
  assert.deepEqual(next.campaign.hexEdits.cells, {
    [next.campaign.partyToken.key]: { visited: true },
  });
  assert.equal(next.canUndo, false);
});

test('local reroll and locking remain replayable; reset preserves tracking', () => {
  const { session } = fixture();
  session.visit();
  assert.equal(session.regenerateHex().ok, true);
  assert.ok(session.snapshot().campaign.hexEdits.cells['0,0'].dressing);
  assert.equal(session.lock().ok, true);
  assert.equal(session.regenerateHex().ok, false);
  const held = structuredClone(
    session.snapshot().dressing.cells.find((cell) => cell.key === '0,0').props,
  );
  session.regenerate();
  assert.deepEqual(
    session.snapshot().dressing.cells.find((cell) => cell.key === '0,0').props,
    held,
  );
  assert.equal(session.reset().ok, true);
  assert.deepEqual(session.snapshot().campaign.hexEdits.cells['0,0'], { visited: true });
});

test('hex regeneration changes cosmetic POI variants while preserving named variants and saved locks', () => {
  const { session } = fixture();
  const before = session.snapshot();
  const cosmetic = before.world.cells.find(
    (cell) => typeof cell.pointsOfInterest[0]?.variant === 'number',
  );
  const propAt = (snapshot, key) =>
    snapshot.dressing.cells
      .find((cell) => cell.key === key)
      .props.find((prop) => prop.kind === 'poi');
  session.select(cosmetic.key);
  let previous = propAt(before, cosmetic.key);
  const variants = new Set([previous.variant]);
  for (let revision = 1; revision <= 2; revision++) {
    assert.equal(session.regenerateHex().ok, true);
    const after = session.snapshot();
    const prop = propAt(after, cosmetic.key);
    assert.notEqual(prop.variant, previous.variant);
    assert.notEqual(prop.detailSeed, previous.detailSeed);
    assert.deepEqual(after.world.pointsOfInterest, before.world.pointsOfInterest);
    variants.add(prop.variant);
    previous = prop;
  }
  assert.equal(variants.size, 3);
  assert.equal(session.lock().ok, true);
  assert.equal(session.regenerate().ok, true);
  assert.deepEqual(propAt(session.snapshot(), cosmetic.key), previous);
  const imported = importCampaign(exportCampaign(session.snapshot().campaign));
  session.open(imported);
  assert.deepEqual(propAt(session.snapshot(), cosmetic.key), previous);
  const named = session
    .snapshot()
    .world.cells.find((cell) => typeof cell.pointsOfInterest[0]?.variant === 'string');
  const namedProp = propAt(session.snapshot(), named.key);
  session.select(named.key);
  assert.equal(session.regenerateHex().ok, true);
  assert.equal(propAt(session.snapshot(), named.key).variant, namedProp.variant);
  assert.equal(propAt(session.snapshot(), named.key).detailSeed, namedProp.detailSeed);
});

test('applying a cosmetic POI kind in a batch retains each existing variant and identity', () => {
  const { session } = fixture();
  const before = session.snapshot();
  const cells = before.world.cells.filter((cell) => cell.pointsOfInterest[0]?.kind === 'abbey');
  assert.ok(new Set(cells.map((cell) => cell.pointsOfInterest[0].variant)).size > 1);
  session.select(cells[0].key);
  session.setMultiEdit(true);
  for (const cell of cells.slice(1)) session.select(cell.key);
  assert.equal(session.applyBatch({ poi: { kind: 'abbey', variant: 0 }, visited: true }).ok, true);
  const after = session.snapshot();
  for (const cell of cells) {
    assert.deepEqual(
      after.world.cells.find((entry) => entry.key === cell.key).pointsOfInterest,
      cell.pointsOfInterest,
    );
    assert.equal(after.campaign.hexEdits.cells[cell.key].visited, true);
  }
});

test('watchtower rerolls change cosmetic seeds and preserve the subtype through saved locks', () => {
  const { session } = fixture();
  const before = session.snapshot();
  const tower = before.world.cells.find(
    (cell) => cell.pointsOfInterest[0]?.variant === 'watchtower',
  );
  const propAt = (snapshot) =>
    snapshot.dressing.cells
      .find((cell) => cell.key === tower.key)
      .props.find((prop) => prop.kind === 'poi');
  session.select(tower.key);
  assert.equal(session.regenerateHex().ok, true);
  const after = session.snapshot();
  assert.equal(propAt(after).variant, 'watchtower');
  assert.notEqual(propAt(after).detailSeed, propAt(before).detailSeed);
  assert.deepEqual(after.world.pointsOfInterest, before.world.pointsOfInterest);
  assert.equal(session.lock().ok, true);
  const imported = importCampaign(exportCampaign(session.snapshot().campaign));
  session.open(imported);
  assert.deepEqual(propAt(session.snapshot()), propAt(after));
});

test('world icon selection persists without rebuilding the world or adding hex Undo history', () => {
  const { session, writes } = fixture();
  session.visit();
  const before = session.snapshot();
  const key = before.world.cells.find((cell) => cell.water)?.key ?? before.world.cells[1].key;
  session.select(key);
  assert.equal(session.icon().scope, 'icon');
  const after = session.snapshot();
  assert.equal(after.campaign.iconKey, key);
  assert.equal(writes.at(-1).iconKey, key);
  assert.equal(after.world, before.world);
  assert.equal(after.dressing, before.dressing);
  assert.equal(session.undo().ok, true);
  assert.equal(session.snapshot().campaign.iconKey, key);
  assert.equal(session.snapshot().canUndo, false);
});
