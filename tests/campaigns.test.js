import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing, GENERATOR_VERSION } from '../src/generation/world.js';
import { readPreferences, savePreferences } from '../src/ui/storage.js';
import { prepareMap } from '../src/generation/presentation.js';
import {
  createCampaign,
  validateCampaign,
  readCampaigns,
  readDeletedCampaign,
  saveCampaigns,
  exportCampaign,
  importCampaign,
  campaignFilename,
  campaignStats,
  findCampaignReplay,
  campaignIconCandidates,
  chooseCampaignIcon,
  replaceCampaignMap,
  MAX_CAMPAIGN_BYTES,
} from '../src/ui/campaigns.js';

const colors = ['#282039', '#237d89', '#e5b96e'];
const world = generateWorld('Żmij & ash/?# + mist');
const campaign = {
  ...createCampaign(world, colors, 'Dusk & gold', 3),
  name: 'My campaign',
  nameEdited: true,
};

test('campaign JSON replays the exact world, dressing and palette across devices', () => {
  const source = exportCampaign(campaign);
  const imported = importCampaign(source);
  assert.deepEqual(imported, campaign);
  assert.deepEqual(generateWorld(imported.seed), world);
  assert.deepEqual(
    generateDressing(generateWorld(imported.seed), imported.variant),
    generateDressing(world, campaign.variant),
  );
  assert.equal(imported.name, 'My campaign');
  assert.equal(imported.generatorVersion, GENERATOR_VERSION);
  assert.notEqual(imported.colors, campaign.colors);
  assert.ok(source.length < 2048, 'saves stay small enough for many local campaigns');
  const defaultCampaign = createCampaign(world, colors, 'Custom');
  assert.equal(defaultCampaign.name, world.name);
  assert.notEqual(defaultCampaign.id, campaign.id);
  assert.ok(
    world.cells.some(
      (cell) =>
        cell.key === defaultCampaign.iconKey &&
        (cell.pointOfLight || cell.pointsOfInterest?.length),
    ),
  );
});

test('campaign import rejects malformed, oversized, incompatible and incomplete files', () => {
  assert.throws(() => importCampaign('{oops'), /not valid JSON/);
  assert.throws(() => importCampaign('{}'), /supported Wilderness Almanac/);
  assert.throws(() => importCampaign(' '.repeat(MAX_CAMPAIGN_BYTES + 1)), /smaller than 4 MB/);
  const envelope = JSON.parse(exportCampaign(campaign));
  assert.throws(() => importCampaign(JSON.stringify({ ...envelope, version: 3 })), /supported/);
  assert.deepEqual(importCampaign(JSON.stringify({ ...envelope, version: 1 })), campaign);
  for (const patch of [
    { name: '' },
    { name: 'a'.repeat(101) },
    { seed: ' ' },
    { seed: 'a'.repeat(129) },
    { id: null },
    { createdAt: 'yesterday' },
    { variant: -1 },
    { variant: 0.5 },
    { variant: Number.MAX_SAFE_INTEGER + 1 },
    { colors: ['red', '#123456', '#ffffff'] },
    { colors: [null, '#123456', '#ffffff'] },
    { paletteName: '' },
    { nameEdited: 'yes' },
    { iconKey: 'not a coordinate' },
    { iconKey: ['0,0'] },
    { iconKey: null },
  ])
    assert.throws(() => validateCampaign({ ...campaign, ...patch }), /invalid campaign data/);
  assert.throws(() => validateCampaign({ ...campaign, generatorVersion: 99 }), /generator version/);
  assert.throws(
    () => importCampaign(JSON.stringify({ ...envelope, campaign: null })),
    /generator version/,
  );
  assert.deepEqual(validateCampaign({ ...campaign, unexpectedGeometry: {} }), campaign);
});

test('local campaign saves retain multiple independent maps and tolerate unavailable storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readCampaigns(storage), null);
  const second = createCampaign(generateWorld('7'), colors, 'Dusk & gold');
  const entries = [campaign, second];
  assert.equal(saveCampaigns(storage, entries), true);
  assert.deepEqual(readCampaigns(storage), entries);
  entries[0] = {
    ...campaign,
    name: 'Renamed',
    variant: 8,
    colors: ['#112233', '#445566', '#778899'],
  };
  saveCampaigns(storage, entries);
  const reread = readCampaigns(storage);
  assert.deepEqual(reread[0], entries[0]);
  assert.deepEqual(reread[1], second);
  savePreferences(storage, { campaignId: second.id });
  assert.equal(readPreferences(storage).campaignId, second.id);
  saveCampaigns(storage, [...entries, { ...campaign, seed: '' }]);
  assert.deepEqual(readCampaigns(storage), entries);
  assert.equal(saveCampaigns(undefined, entries), false);
  assert.equal(readCampaigns(undefined), null);
  saveCampaigns(storage, []);
  assert.deepEqual(readCampaigns(storage), []);
});

test('export names include a safe campaign slug and the local export date', () => {
  const date = new Date(2026, 9, 19, 12);
  assert.equal(campaignFilename(campaign, date), 'wilderness-almanac-my-campaign-2026-10-19.json');
  assert.equal(
    campaignFilename({ ...campaign, name: '../../Żmij: The "Ash" / Coast?' }, date),
    'wilderness-almanac-żmij-the-ash-coast-2026-10-19.json',
  );
  assert.equal(campaignFilename({ name: '🏔' }, date), 'wilderness-almanac-campaign-2026-10-19.json');
});

test('New Map replaces a campaign world while preserving its identity and palette', () => {
  const before = structuredClone(campaign);
  const replacement = generateWorld('replacement world');
  const updated = replaceCampaignMap(campaign, replacement);
  assert.deepEqual(campaign, before);
  for (const key of ['id', 'name', 'createdAt', 'colors', 'paletteName'])
    assert.deepEqual(updated[key], campaign[key]);
  assert.equal(updated.seed, replacement.seed);
  assert.equal(updated.variant, 0);
  assert.ok(campaignIconCandidates(replacement).some((cell) => cell.key === updated.iconKey));
  assert.ok(
    replacement.cells.some(
      (cell) =>
        cell.key === updated.iconKey && (cell.pointOfLight || cell.pointsOfInterest?.length),
    ),
  );
  const replay = importCampaign(exportCampaign(updated));
  assert.deepEqual(generateWorld(replay.seed), replacement);
  assert.equal(replay.iconKey, updated.iconKey);
});

test('default campaign names follow New Map while edited names survive, including older saves', () => {
  const replacement = generateWorld('new default name');
  const original = createCampaign(world, colors, 'Dusk & gold');
  const updated = replaceCampaignMap(original, replacement, world.name);
  assert.equal(updated.name, replacement.name);
  assert.equal(updated.nameEdited, false);
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  const legacyDefault = { ...original };
  delete legacyDefault.nameEdited;
  assert.equal(replaceCampaignMap(legacyDefault, replacement, world.name).name, replacement.name);
  const legacyRenamed = { ...campaign };
  delete legacyRenamed.nameEdited;
  assert.equal(replaceCampaignMap(legacyRenamed, replacement, world.name).name, campaign.name);
  const explicitName = { ...original, nameEdited: true };
  assert.equal(replaceCampaignMap(explicitName, replacement, world.name).name, world.name);
  assert.equal(importCampaign(exportCampaign(updated)).nameEdited, false);
});

test('initial icons use settlement/POI tiles; refresh rolls the pool before selecting a tile', () => {
  const base = { terrain: 'meadow', water: null, pointOfLight: null, pointsOfInterest: [] };
  const cells = [
    { ...base, key: '0,0' },
    { ...base, key: '1,0', terrain: 'ocean', water: 'ocean' },
    { ...base, key: '2,0', terrain: 'lake', water: 'lake' },
    { ...base, key: '3,0', terrain: 'dense forest' },
    { ...base, key: '4,0', terrain: 'mountains', elevation: 4 },
    { ...base, key: '5,0', terrain: 'river', water: 'river' },
    { ...base, key: '6,0', terrain: 'wetlands' },
    { ...base, key: '7,0', terrain: 'farmlands' },
    { ...base, key: '8,0', pointOfLight: { type: 'village' } },
    { ...base, key: '9,0', pointsOfInterest: [{ kind: 'stronghold' }] },
  ];
  const model = { cells };
  const eligible = campaignIconCandidates(model);
  assert.deepEqual(eligible, cells.slice(3));
  assert.equal(
    chooseCampaignIcon(model, undefined, () => 0),
    '8,0',
  );
  assert.equal(
    chooseCampaignIcon(model, '3,0', () => 0),
    '8,0',
  );
  assert.equal(
    chooseCampaignIcon(model, '4,0', () => 0.999),
    '7,0',
  );
  assert.equal(
    chooseCampaignIcon(model, undefined, () => 0.999),
    '9,0',
  );
  const roll = (pool, tile) => {
    const values = [pool, tile];
    return chooseCampaignIcon(model, '3,0', () => values.shift());
  };
  assert.equal(roll(0.499999, 0.999), '9,0');
  assert.equal(roll(0.5, 0), '4,0');
  // Two landmark tiles and five terrain tiles still receive equal pool odds.
  const counts = new Map();
  for (let i = 0; i < 1000; i++) {
    const values = [i / 1000, ((i * 137) % 1000) / 1000];
    const key = chooseCampaignIcon(model, 'not-a-key', () => values.shift());
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.get('8,0') + counts.get('9,0'), 500);
  assert.equal(
    [...counts.values()].reduce((sum, count) => sum + count, 0),
    1000,
  );
  assert.equal(counts.size, 7, 'Both pools reach every eligible tile');
  assert.equal(chooseCampaignIcon({ cells: [cells[3]] }, '3,0'), '3,0');
  assert.equal(chooseCampaignIcon({ cells: cells.slice(3, 8) }), undefined);
  assert.equal(
    chooseCampaignIcon({ cells: [cells[8], cells[3]] }, '8,0', () => 0),
    '3,0',
  );
  assert.equal(
    chooseCampaignIcon({ cells: [cells[8], cells[9]] }, '8,0', () => 0.9),
    '9,0',
  );
  assert.equal(chooseCampaignIcon({ cells: [] }, 'missing'), undefined);
  assert.equal(chooseCampaignIcon({ cells: cells.slice(0, 3) }), undefined);
  const older = { ...campaign };
  delete older.iconKey;
  assert.deepEqual(importCampaign(exportCampaign(older)), older);
  const shuffled = { ...campaign, iconKey: chooseCampaignIcon(world, campaign.iconKey) };
  assert.notEqual(shuffled.iconKey, campaign.iconKey);
  assert.deepEqual(importCampaign(exportCampaign(shuffled)), shuffled);
});

test('individual icon preparation retains the complete map river and mountain geometry', () => {
  const model = generateWorld('7');
  const dressing = generateDressing(model, 2);
  const original = JSON.stringify({ model, dressing });
  const full = prepareMap(model, dressing);
  const samples = [
    full.find((cell) => cell.water === 'river'),
    full.find((cell) => cell.elevation === 4),
    full.find((cell) => cell.terrain === 'dense forest'),
  ];
  assert.ok(samples.every(Boolean));
  for (const sample of samples)
    assert.deepEqual(prepareMap(model, dressing, { cellKeys: [sample.key] }), [sample]);
  assert.equal(JSON.stringify({ model, dressing }), original);
});

test('deletion stays removed after reload and retains one recoverable campaign with its list position', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const second = createCampaign(generateWorld('7'), colors, 'Custom');
  const deleted = { campaign, index: 0 };
  saveCampaigns(storage, [second], deleted);
  assert.deepEqual(readCampaigns(storage), [second]);
  assert.deepEqual(readDeletedCampaign(storage), deleted);
  const restored = readCampaigns(storage);
  const archived = readDeletedCampaign(storage);
  restored.splice(archived.index, 0, archived.campaign);
  saveCampaigns(storage, restored);
  assert.deepEqual(readCampaigns(storage), [campaign, second]);
  assert.equal(readDeletedCampaign(storage), null);
  saveCampaigns(storage, [], { campaign, index: 0 });
  assert.deepEqual(readCampaigns(storage), []);
  assert.deepEqual(readDeletedCampaign(storage).campaign, campaign);
  assert.equal(readDeletedCampaign(undefined), null);
});

test('reload keeps the active campaign identity when imported copies replay the same map', () => {
  const copy = { ...campaign, id: 'imported-copy', name: 'Traveling campaign' };
  const entries = [campaign, copy];
  assert.equal(findCampaignReplay(entries, { ...copy, campaignId: copy.id }), copy);
  assert.equal(findCampaignReplay(entries, campaign), campaign);
  assert.equal(
    findCampaignReplay(entries, { ...copy, seed: 'another seed', campaignId: copy.id }),
    undefined,
  );
  assert.equal(findCampaignReplay(entries, { ...copy, variant: 9 }), undefined);
  assert.equal(
    findCampaignReplay(entries, { ...copy, colors: ['#ffffff', '#ffffff', '#ffffff'] }),
    undefined,
  );
});

test('menu metadata counts settlements once per footprint and excludes river channels from the ratio', () => {
  const summary = campaignStats({
    cells: [
      { water: 'ocean' },
      { water: 'lake' },
      { water: 'river' },
      { water: null },
      { water: null },
    ],
    settlements: [{ hexKeys: ['a', 'b'] }, { hexKeys: ['c'] }],
    pointsOfInterest: [{}, {}, {}],
  });
  assert.deepEqual(summary, {
    settlements: 2,
    pois: 3,
    openWater: 2,
    land: 2,
    waterPercent: 50,
    landPercent: 50,
  });
  const stats = campaignStats(world);
  assert.equal(stats.waterPercent + stats.landPercent, 100);
  assert.equal(stats.pois, world.pointsOfInterest.length);
});
