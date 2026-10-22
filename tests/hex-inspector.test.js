import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
  inspectDistances,
} from '../src/generation/campaign-world.js';
import { validateHexEdits } from '../src/generation/hex-edits.js';
import { prepareMap } from '../src/generation/presentation.js';
import {
  createCampaign,
  exportCampaign,
  importCampaign,
  replaceCampaignMap,
} from '../src/application/campaigns.js';
import { neighbours, distance } from '../src/generation/hex.js';
import { minimumSpacing } from '../src/generation/prop-placement.js';
import { readPreferences, savePreferences } from '../src/ui/storage.js';

const base = generateWorld('7');
const campaign = createCampaign(base, ['#cdab8f', '#0b365e', '#11b329'], 'Forbidden Lands');
const find = (world, key) =>
  (Array.isArray(world) ? world : world.cells).find((cell) => cell.key === key);
const json = (value) => JSON.parse(JSON.stringify(value));
const finiteSurface = (layout) => {
  for (const cell of layout)
    for (const surface of [cell.surface, cell.riverSurface])
      if (surface) assert.ok(surface.vertices.flat().every(Number.isFinite));
};

test('unmodified and tracking-only campaigns preserve the exact generated world and visuals', () => {
  assert.equal(campaignWorld(campaign, base), base);
  assert.deepEqual(campaignDressing(campaign, base), generateDressing(base, 0));
  const visited = updateHex(campaign, '0,0', { visited: true });
  assert.equal(campaignWorld(visited, base), base);
  assert.deepEqual(campaignDressing(visited, base), generateDressing(base, 0));
  assert.equal(importCampaign(exportCampaign(visited)).hexEdits.cells['0,0'].visited, true);
  assert.equal(campaign.hexEdits, undefined);
});

test('manual terrain, settlements and POI subtypes compose and survive JSON replay', () => {
  const before = structuredClone(base);
  const edited = updateHex(campaign, '0,0', {
    terrain: 'meadow',
    elevation: 2,
    settlement: 'village',
    poi: { kind: 'dungeon', variant: 'mine' },
    crossing: null,
  });
  const world = campaignWorld(edited, base),
    cell = find(world, '0,0');
  assert.equal(cell.elevation, 2);
  assert.equal(cell.pointOfLight.type, 'village');
  assert.equal(cell.pointsOfInterest[0].variant, 'mine');
  const dressing = campaignDressing(edited, world);
  const props = find(dressing, cell.key).props;
  assert.ok(props.some((prop) => prop.kind === 'house'));
  assert.ok(props.some((prop) => prop.kind === 'poi' && prop.poiKind === 'dungeon'));
  const imported = importCampaign(exportCampaign(edited));
  assert.deepEqual(campaignWorld(imported), world);
  assert.deepEqual(campaignDressing(imported, campaignWorld(imported)), dressing);
  assert.deepEqual(base, before);
});

test('every terrain is editable, with fixed water/mountain elevation and finite geometry', () => {
  for (const terrain of [
    'meadow',
    'farmlands',
    'light forest',
    'dense forest',
    'wetlands',
    'mountains',
    'river',
    'open water',
  ]) {
    const edited = updateHex(campaign, '0,0', {
      terrain,
      elevation: 3,
      poi: null,
      settlement: null,
      crossing: null,
    });
    const world = campaignWorld(edited, base),
      cell = find(world, '0,0');
    assert.equal(cell.terrain, terrain);
    assert.equal(
      cell.elevation,
      ['river', 'open water'].includes(terrain) ? 0 : terrain === 'mountains' ? 4 : 3,
    );
    if (terrain === 'river') assert.ok(cell.riverWidth > 0);
    if (terrain === 'mountains')
      assert.ok(world.elevation.ranges.some((range) => range.hexKeys.includes(cell.key)));
    finiteSurface(prepareMap(world, campaignDressing(edited, world)));
  }
});

test('water rules reject invalid edits and valid conversions remove incompatible original features', () => {
  const village = base.cells.find((cell) => cell.pointOfLight?.type === 'village');
  const edited = updateHex(campaign, village.key, {
    terrain: 'open water',
    settlement: null,
    poi: null,
    crossing: null,
  });
  const world = campaignWorld(edited, base);
  assert.equal(find(world, village.key).pointOfLight, undefined);
  assert.equal(world.settlements.length, base.settlements.length - 1);
  assert.throws(
    () =>
      campaignWorld(
        updateHex(campaign, village.key, {
          terrain: 'open water',
          poi: { kind: 'ruins', variant: 0 },
        }),
        base,
      ),
    /Open water/,
  );
  assert.throws(
    () => campaignWorld(updateHex(campaign, village.key, { crossing: 'bridge' }), base),
    /only.*rivers/,
  );
});

test('removing river sections repairs upstream references without changing unrelated routes', () => {
  const removed = base.cells.find((cell) => cell.water === 'river' && cell.upstream.length);
  const edited = updateHex(campaign, removed.key, {
    terrain: 'meadow',
    elevation: 1,
    poi: null,
    settlement: null,
    crossing: null,
  });
  const world = campaignWorld(edited, base);
  for (const cell of world.cells.filter((cell) => cell.water === 'river')) {
    assert.notEqual(cell.downstream, removed.key);
    assert.ok(!cell.upstream.includes(removed.key));
    if (find(base, cell.key).downstream !== removed.key)
      assert.equal(cell.downstream, find(base, cell.key).downstream);
  }
  finiteSurface(prepareMap(world, campaignDressing(edited, world)));
});

test('isolated rivers, sources and new river connections render without invalid geometry or cycles', () => {
  const byKey = new Map(base.cells.map((cell) => [cell.key, cell]));
  const isolated = base.cells.find(
    (cell) => !cell.water && neighbours(cell, byKey).every((next) => !next.water),
  );
  let edited = updateHex(campaign, isolated.key, {
    terrain: 'river',
    elevation: 0,
    settlement: null,
    poi: null,
    crossing: null,
  });
  const next = neighbours(isolated, byKey).find((cell) => !cell.water);
  edited = updateHex(edited, next.key, {
    terrain: 'river',
    elevation: 0,
    settlement: null,
    poi: null,
    crossing: null,
  });
  const world = campaignWorld(edited, base);
  for (const start of world.cells.filter((cell) => cell.water === 'river')) {
    const seen = new Set();
    let cell = start;
    while (cell?.water === 'river') {
      assert.ok(!seen.has(cell.key));
      seen.add(cell.key);
      cell = find(world, cell.downstream);
    }
  }
  finiteSurface(prepareMap(world, campaignDressing(edited, world)));
});

test('manual crossings fit river banks and survive replay', () => {
  const crossing = base.cells.find((cell) => cell.crossing);
  assert.ok(crossing);
  const edited = updateHex(campaign, crossing.key, {
    crossing: crossing.crossing.kind === 'bridge' ? 'ferry' : 'bridge',
  });
  const world = campaignWorld(edited, base);
  assert.equal(
    find(world, crossing.key).crossing.kind,
    edited.hexEdits.cells[crossing.key].crossing,
  );
  assert.deepEqual(campaignWorld(importCampaign(exportCampaign(edited))), world);
});

test('individual rerolls preserve every other tile and replay exactly after reload', () => {
  for (const terrain of ['dense forest', 'meadow', 'mountains']) {
    const cell = base.cells.find((entry) => entry.terrain === terrain && !entry.pointOfLight);
    const before = campaignDressing(campaign, base);
    let edited = updateHex(campaign, cell.key, { revision: 1 });
    const fixedCells = Object.fromEntries(
      before.cells.filter((entry) => entry.key !== cell.key).map((entry) => [entry.key, entry]),
    );
    const after = campaignDressing(edited, base, { fixedCells, rerollKey: cell.key });
    for (const other of before.cells.filter((entry) => entry.key !== cell.key))
      assert.deepEqual(find(after, other.key).props, other.props);
    edited.hexEdits.cells[cell.key].dressing = find(after, cell.key);
    edited.hexEdits.cells[cell.key].dressingVariant = edited.variant;
    const replay = importCampaign(exportCampaign(edited));
    const replayed = campaignDressing(replay, campaignWorld(replay));
    assert.deepEqual(
      json(replayed.cells.map((entry) => entry.props)),
      json(after.cells.map((entry) => entry.props)),
    );
    if (terrain !== 'mountains')
      assert.notDeepEqual(find(after, cell.key).props, find(before, cell.key).props);
    else {
      const oldLayout = prepareMap(base, before),
        newLayout = prepareMap(base, after);
      assert.notDeepEqual(find(oldLayout, cell.key).surface, find(newLayout, cell.key).surface);
      for (const other of oldLayout.filter((entry) => entry.key !== cell.key))
        assert.deepEqual(find(newLayout, other.key).surface, other.surface);
    }
  }
});

test('locked props and mountain shapes survive global regeneration and import', () => {
  const before = campaignDressing(campaign, base);
  const forest = base.cells.find((cell) => cell.terrain === 'dense forest');
  const mountain = base.cells.find((cell) => cell.terrain === 'mountains');
  let edited = lockHex(lockHex(campaign, forest.key, base, before), mountain.key, base, before);
  edited = { ...edited, variant: 2 };
  const after = campaignDressing(edited, base);
  for (const cell of [forest, mountain])
    assert.deepEqual(find(after, cell.key).props, find(before, cell.key).props);
  assert.deepEqual(
    find(prepareMap(base, before), mountain.key).surface,
    find(prepareMap(base, after), mountain.key).surface,
  );
  const replay = importCampaign(exportCampaign(edited));
  assert.deepEqual(json(campaignDressing(replay, campaignWorld(replay))), json(after));
  const byKey = new Map(base.cells.map((cell) => [cell.key, cell]));
  for (const next of neighbours(forest, byKey)) {
    for (const a of find(after, forest.key).props.filter((prop) => prop.kind === 'tree'))
      for (const b of find(after, next.key).props.filter((prop) => prop.kind === 'tree'))
        assert.ok(
          Math.hypot(forest.wx + a.x - next.wx - b.x, forest.wz + a.z - next.wz - b.z) >=
            minimumSpacing(a, b) - 1e-8,
        );
  }
});

test('reset/new maps and structural edits clear dressing overrides without erasing unrelated data', () => {
  const before = campaignDressing(campaign, base);
  const cell = base.cells.find((entry) => entry.terrain === 'dense forest');
  const locked = lockHex(updateHex(campaign, cell.key, { visited: true }), cell.key, base, before);
  const changed = updateHex(locked, cell.key, { terrain: 'meadow' });
  assert.equal(changed.hexEdits.cells[cell.key].lock, undefined);
  assert.equal(changed.hexEdits.cells[cell.key].visited, true);
  assert.equal(replaceCampaignMap(locked, generateWorld('next'), base.name).hexEdits, undefined);
});

test('distances exclude the current settlement and handle missing targets', () => {
  const cell = base.cells.find((entry) => entry.pointOfLight);
  const distances = inspectDistances(base, cell);
  assert.equal(
    distances.settlement,
    Math.min(
      ...base.cells
        .filter((entry) => entry.pointOfLight && entry.pointOfLight.id !== cell.pointOfLight.id)
        .map((entry) => distance(cell, entry)),
    ),
  );
  assert.equal(
    distances.river,
    Math.min(
      ...base.cells
        .filter((entry) => entry.water === 'river')
        .map((entry) => distance(cell, entry)),
    ),
  );
  assert.deepEqual(
    inspectDistances({ cells: [{ ...cell, pointOfLight: null, water: null }] }, cell),
    { settlement: null, river: null, water: null },
  );
});

test('edit imports reject invalid keys, variants, revisions and unbounded frozen prop data', () => {
  for (const [key, edit] of [
    ['99,0', {}],
    ['-0,0', {}],
    ['0,0', { terrain: 'lava' }],
    ['0,0', { revision: -1 }],
    ['0,0', { elevation: 5 }],
    ['0,0', { poi: { kind: 'dungeon', variant: 'castle' } }],
    ['0,0', { lock: { props: [{ kind: 'house', x: 0, y: 0, z: 0, footprint: 0.2, scale: 999 }] } }],
  ])
    assert.throws(() => validateHexEdits({ version: 1, cells: { [key]: edit } }), /invalid hex/);
});

test('panel order and disclosure preferences are validated and saved globally', () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
  savePreferences(storage, {
    panelOrder: ['inspector', 'tracker'],
    panelsCollapsed: { tracker: false, inspector: true },
    panelsHorizontal: { tracker: true, inspector: false },
  });
  assert.deepEqual(readPreferences(storage).panelOrder, ['inspector', 'tracker']);
  assert.deepEqual(readPreferences(storage).panelsCollapsed, { tracker: false, inspector: true });
  assert.deepEqual(readPreferences(storage).panelsHorizontal, { tracker: true, inspector: false });
  savePreferences(storage, {
    panelOrder: ['inspector', 'inspector'],
    panelsCollapsed: { tracker: 'yes', inspector: true },
    panelsHorizontal: { tracker: true, inspector: 'no' },
  });
  assert.equal(readPreferences(storage).panelOrder, undefined);
  assert.equal(readPreferences(storage).panelsCollapsed, undefined);
  assert.equal(readPreferences(storage).panelsHorizontal, undefined);
});

test('editing part of a city removes only that hex and repairs its centre and footprint size', () => {
  const original = generateWorld('0');
  const city = original.settlements.find((settlement) => settlement.hexKeys.length >= 2);
  assert.ok(city);
  const initial = createCampaign(original, campaign.colors, campaign.paletteName);
  const edited = updateHex(initial, city.anchorKey, { settlement: null });
  const world = campaignWorld(edited, original);
  const remainder = world.settlements.find((settlement) => settlement.id === city.id);
  assert.ok(remainder);
  assert.equal(remainder.hexKeys.length, city.hexKeys.length - 1);
  assert.ok(!remainder.hexKeys.includes(city.anchorKey));
  assert.equal(find(world, remainder.anchorKey).pointOfLight.centre, true);
  for (const key of remainder.hexKeys)
    assert.equal(find(world, key).pointOfLight.size, remainder.hexKeys.length);
});

test('river POIs use dry bank footprints and reject frozen POIs on open water', () => {
  const river = base.cells.find((cell) => cell.water === 'river');
  const edited = updateHex(campaign, river.key, { poi: { kind: 'dungeon', variant: 'mine' } });
  const world = campaignWorld(edited, base);
  const dressing = campaignDressing(edited, world);
  const prop = find(dressing, river.key).props.find((entry) => entry.kind === 'poi');
  assert.ok(prop && prop.y > 0);
  assert.deepEqual(
    json(campaignDressing(importCampaign(exportCampaign(edited)), world)),
    json(dressing),
  );
  const ocean = base.cells.find((cell) => cell.water === 'ocean');
  const bad = updateHex(campaign, ocean.key, { lock: { props: [prop] } });
  assert.throws(() => campaignDressing(bad, base), /Open water/);
});

test('edit history shares untouched records while keeping previous states immutable', () => {
  const initial = updateHex(updateHex(campaign, '0,0', { visited: true }), '1,0', {
    visited: true,
  });
  const before = json(initial);
  const next = updateHex(initial, '0,0', { visited: false });
  assert.deepEqual(json(initial), before);
  assert.equal(next.hexEdits.cells['1,0'], initial.hexEdits.cells['1,0']);
  assert.notEqual(next.hexEdits.cells['0,0'], initial.hexEdits.cells['0,0']);
});

test('unlocking retains current dressing until the next regeneration, including a held mountain range', () => {
  const cell = base.cells.find((entry) => entry.terrain === 'mountains');
  const original = campaignDressing(campaign, base);
  const held = { ...lockHex(campaign, cell.key, base, original), variant: 2 };
  const before = campaignDressing(held, base);
  const unlocked = updateHex(held, cell.key, {});
  unlocked.hexEdits.cells[cell.key].dressing = unlocked.hexEdits.cells[cell.key].lock;
  unlocked.hexEdits.cells[cell.key].dressingVariant = 2;
  delete unlocked.hexEdits.cells[cell.key].lock;
  const replay = importCampaign(exportCampaign(unlocked));
  const after = campaignDressing(replay, base);
  assert.deepEqual(json(find(after, cell.key).props), json(find(before, cell.key).props));
  assert.deepEqual(
    find(prepareMap(base, after), cell.key).surface,
    find(prepareMap(base, before), cell.key).surface,
  );
  const regenerated = campaignDressing({ ...replay, variant: 3 }, base);
  assert.notDeepEqual(
    find(prepareMap(base, regenerated), cell.key).surface,
    find(prepareMap(base, before), cell.key).surface,
  );
});
