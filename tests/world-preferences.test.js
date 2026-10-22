import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/generation/world.js';
import { worldPreferences, preferenceWeights } from '../src/generation/world-preferences.js';
import { nameModifiers } from '../src/generation/map-names.js';
import { distance, neighbours, components } from '../src/generation/hex.js';
import {
  createCampaign,
  exportCampaign,
  importCampaign,
  findCampaignReplay,
  validateCampaign,
} from '../src/application/campaigns.js';
import { campaignWorld } from '../src/generation/campaign-world.js';
import { mapLink, readMapLink } from '../src/ui/map-link.js';

const colors = ['#cdab8f', '#0b365e', '#11b329'];
const forestCount = (world) => world.cells.filter((cell) => cell.terrain.includes('forest')).length;
const openFraction = (world) =>
  world.cells.filter((cell) => ['ocean', 'lake'].includes(cell.water)).length / world.cells.length;

test('preferences validate bounded discrete inputs and stack past saturated name weights', () => {
  assert.deepEqual(worldPreferences({ water: 1 }), {
    water: 1,
    elevation: 0,
    forests: 0,
    settlements: 0,
  });
  for (const value of [
    null,
    [],
    { water: 3 },
    { forests: -3 },
    { elevation: 0.5 },
    { water: '1' },
    { unknown: 0 },
  ])
    assert.throws(() => worldPreferences(value));
  const weights = nameModifiers(['LW', 'DW', 'LW', 'DW', 'PL']);
  const boosted = preferenceWeights({
    naming: { weights },
    preferences: { forests: 1, settlements: 1 },
  });
  assert.equal(boosted.LW, weights.LW * 2.1);
  assert.equal(boosted.PL, weights.PL * 2.1);
  assert.throws(() => generateWorld('7', { generatorVersion: 6, preferences: { water: 1 } }));
});

test('version 6 replay stays exact and explicit version 7 retains the same generated landscape', () => {
  const snapshots = {
    // Pre-preferences version-6 fixtures, with only the approved display words renamed.
    0: '0c56683ca860a7fabd8858bf97373fd6a23cf797176eccfa1c12926556fd580c',
    7: 'cf3e7bac8a110c56b255b5dcb4e8f96adbee87987dc8a253fe2651c9135f1d93',
    10: '9851ad96a03dbe4e3f1d1255582a8b1c0bc420533d6ab3c421ec4b45f902bb41',
  };
  for (const [seed, hash] of Object.entries(snapshots)) {
    const legacy = generateWorld(seed, { generatorVersion: 6 });
    assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'), hash);
    const current = generateWorld(seed, { generatorVersion: 7 });
    const { preferences, generatorVersion, ...landscape } = current;
    const { generatorVersion: oldVersion, ...oldLandscape } = legacy;
    assert.deepEqual(landscape, oldLandscape);
    assert.equal(generatorVersion, 7);
    assert.equal(oldVersion, 6);
    assert.deepEqual(preferences, worldPreferences());
  }
});

test('water preferences retain seeds, adjust coastal edges and reach global water targets', () => {
  for (const seed of ['0', '7', '10']) {
    const worlds = [-2, -1, 0, 1, 2].map((water) =>
      generateWorld(seed, { preferences: { water } }),
    );
    const [dry, less, base, more, wet] = worlds;
    assert.ok(dry.geography.coastEdges.length <= 1);
    assert.ok(openFraction(dry) >= 0.07 && openFraction(dry) <= 0.14);
    assert.equal(
      less.geography.coastEdges.length,
      Math.max(0, base.geography.coastEdges.length - 1),
    );
    assert.equal(
      wet.geography.coastEdges.length,
      Math.min(6, base.geography.coastEdges.length + 2),
    );
    assert.ok(openFraction(more) > openFraction(base) + 0.06);
    assert.ok(openFraction(less) <= openFraction(base) + 0.01);
    assert.ok(openFraction(wet) >= 0.7 && openFraction(wet) <= 0.91);
    assert.ok(wet.geography.islands.length > 0);
    for (const world of worlds) assert.equal(world.seed, seed);
  }
});

test('elevation extremes change relief while leaving water and drainage intact', () => {
  const worlds = [-2, 0, 2].map((elevation) => generateWorld('7', { preferences: { elevation } }));
  const count = (world, predicate) => {
    const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
    return world.cells.reduce(
      (sum, cell) =>
        sum +
        neighbours(cell, byKey).filter((other) =>
          predicate(Math.abs(cell.elevation - other.elevation)),
        ).length,
      0,
    );
  };
  assert.ok(
    count(worlds[0], (difference) => difference >= 2) <
      count(worlds[1], (difference) => difference >= 2),
  );
  assert.ok(
    count(worlds[2], (difference) => difference >= 2) >
      count(worlds[1], (difference) => difference >= 2),
  );
  assert.ok(worlds[2].elevation.ranges.length > worlds[1].elevation.ranges.length);
  assert.deepEqual(
    worlds[0].cells.map((cell) => [cell.water, cell.downstream]),
    worlds[2].cells.map((cell) => [cell.water, cell.downstream]),
  );
});

test('forest endpoints thin about 80 percent and replace most remaining meadow coherently', () => {
  const worlds = [-2, -1, 0, 1, 2].map((forests) =>
    generateWorld('7', { preferences: { forests } }),
  );
  const counts = worlds.map(forestCount);
  for (let index = 1; index < counts.length; index++) assert.ok(counts[index] > counts[index - 1]);
  assert.ok(Math.abs(counts[0] / counts[2] - 0.2) < 0.05);
  assert.equal(worlds[4].terrain.openLandMinimum, 0);
  assert.deepEqual(
    worlds[0].cells.map((cell) => [cell.water, cell.elevation]),
    worlds[4].cells.map((cell) => [cell.water, cell.elevation]),
  );
});

test('wilderness caps settlements and nearby farmland, while dense settlements expand footprints', () => {
  let largeCity = false,
    largeTown = false;
  for (const seed of ['0', '7', '10', '11']) {
    const wild = generateWorld(seed, { preferences: { settlements: -2 } });
    assert.ok(wild.settlements.length <= 6);
    assert.equal(wild.settlements.filter((entry) => entry.type === 'city').length, 0);
    assert.ok(wild.settlements.filter((entry) => entry.type === 'town').length <= 3);
    assert.ok(wild.settlements.filter((entry) => entry.type === 'village').length <= 5);
    assert.ok(wild.terrain.counts.farmlands <= wild.settlements.length);
    for (const settlement of wild.settlements) {
      const members = wild.cells.filter((cell) => cell.pointOfLight?.id === settlement.id);
      assert.ok(
        wild.cells.filter(
          (cell) =>
            cell.terrain === 'farmlands' && members.some((other) => distance(cell, other) <= 2),
        ).length <= 1,
      );
    }
    for (const region of wild.regions)
      assert.ok(
        wild.settlements.filter((entry) => entry.type === 'town' && entry.regionId === region.id)
          .length <= 1,
      );
    const dense = generateWorld(seed, { preferences: { settlements: 2 } });
    const byKey = new Map(dense.cells.map((cell) => [cell.key, cell]));
    for (const settlement of dense.settlements) {
      assert.ok(
        settlement.hexKeys.length <=
          (settlement.type === 'city' ? 6 : settlement.type === 'town' ? 2 : 1),
      );
      assert.equal(
        components(
          settlement.hexKeys.map((key) => byKey.get(key)),
          byKey,
        ).length,
        1,
      );
      largeCity ||= settlement.type === 'city' && settlement.hexKeys.length >= 4;
      largeTown ||= settlement.type === 'town' && settlement.hexKeys.length === 2;
    }
  }
  assert.ok(largeCity && largeTown);
});

test('custom settings replay through creation, export, URL sharing and campaign identity matching', () => {
  const preferences = { water: 2, elevation: 2, forests: 2, settlements: 2 };
  const world = generateWorld('7', { preferences });
  assert.deepEqual(world, generateWorld('7', { preferences }));
  const campaign = createCampaign(world, colors, 'Custom');
  const imported = importCampaign(exportCampaign(campaign));
  assert.deepEqual(imported.preferences, preferences);
  assert.deepEqual(campaignWorld(imported), world);
  const replay = readMapLink(mapLink('https://example.com/', campaign));
  assert.deepEqual(campaignWorld({ ...campaign, ...replay }), world);
  assert.equal(findCampaignReplay([campaign], { ...replay, campaignId: campaign.id }), campaign);
  assert.equal(findCampaignReplay([campaign], { ...replay, preferences: {} }), undefined);
  for (const invalid of [{ water: 3 }, { forests: '2' }, { extra: 1 }])
    assert.throws(() => validateCampaign({ ...campaign, preferences: invalid }));
  assert.equal(readMapLink('https://example.com/?seed=7&generator=99').seed, undefined);
  assert.equal(
    readMapLink('https://example.com/?seed=7&generator=7&world=3,0,0,0').seed,
    undefined,
  );
  const old = createCampaign(generateWorld('7', { generatorVersion: 6 }), colors, 'Custom');
  assert.deepEqual(
    campaignWorld(importCampaign(exportCampaign(old))),
    generateWorld('7', { generatorVersion: 6 }),
  );
});
