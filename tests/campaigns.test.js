import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing, GENERATOR_VERSION } from '../src/generation/world.js';
import { createCampaignStore } from '../src/ui/campaign-store.js';
import { readPreferences, savePreferences } from '../src/ui/storage.js';
import { prepareMap } from '../src/generation/presentation.js';
import {
  createCampaign,
  validateCampaign,
  exportCampaign,
  importCampaign,
  campaignFilename,
  campaignStats,
  findCampaignReplay,
  campaignIconCandidates,
  chooseCampaignIcon,
  replaceCampaignMap,
  MAX_CAMPAIGN_BYTES,
} from '../src/application/campaigns.js';

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
  assert.deepEqual(
    importCampaign(JSON.stringify({ ...envelope, format: 'previous-product-campaign' })),
    campaign,
  );
  assert.equal(envelope.format, 'wilderness-almanac-campaign');
  for (const format of [
    'campaign',
    'unrelated',
    'previous-product-recovery',
    'x'.repeat(100) + '-campaign',
  ])
    assert.throws(() => importCampaign(JSON.stringify({ ...envelope, format })), /supported/);
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
  const store = createCampaignStore(storage);
  assert.equal(store.missing, true);
  const second = createCampaign(generateWorld('7'), colors, 'Dusk & gold');
  const entries = [campaign, second];
  assert.equal(store.save(entries), true);
  assert.deepEqual(createCampaignStore(storage).campaigns, entries);
  entries[0] = {
    ...campaign,
    name: 'Renamed',
    variant: 8,
    colors: ['#112233', '#445566', '#778899'],
  };
  assert.equal(store.save(entries), true);
  assert.deepEqual(createCampaignStore(storage).campaigns, entries);
  savePreferences(storage, { campaignId: second.id });
  assert.equal(readPreferences(storage).campaignId, second.id);
  assert.equal(store.save([...entries, { ...campaign, seed: '' }]), false);
  assert.deepEqual(createCampaignStore(storage).campaigns, entries);
  assert.equal(createCampaignStore(undefined).save(entries), false);
  assert.deepEqual(createCampaignStore(undefined).campaigns, []);
  assert.equal(store.save([]), true);
  assert.deepEqual(createCampaignStore(storage).campaigns, []);
});

test('export names include a safe campaign slug and the local export date', () => {
  const date = new Date(2026, 9, 19, 12);
  assert.equal(campaignFilename(campaign, date), 'wilderness-almanac-my-campaign-2026-10-19.json');
  assert.equal(
    campaignFilename({ ...campaign, name: '../../Żmij: The "Ash" / Coast?' }, date),
    'wilderness-almanac-żmij-the-ash-coast-2026-10-19.json',
  );
  assert.equal(
    campaignFilename({ name: '🏔' }, date),
    'wilderness-almanac-campaign-2026-10-19.json',
  );
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

test('icon galleries select four settlements and four distinct POIs in stable order', () => {
  const base = { terrain: 'meadow', water: null, pointsOfInterest: [] };
  const settlements = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    key: `${i},0`,
    pointOfLight: { type: 'village' },
  }));
  settlements[0].pointsOfInterest = [{ kind: 'watchtower' }];
  const pois = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    key: `${i},1`,
    pointsOfInterest: [{ kind: 'ruins' }],
  }));
  const model = { cells: [...settlements, ...pois] };
  const expected = [...settlements.slice(0, 4), ...pois.slice(0, 4)];
  assert.deepEqual(campaignIconCandidates(model), expected);
  assert.deepEqual(campaignIconCandidates(model), expected);
  assert.equal(chooseCampaignIcon(model), settlements[0].key);
  assert.equal(new Set(expected.map((cell) => cell.key)).size, 8);
  assert.deepEqual(campaignIconCandidates({ cells: [...settlements, pois[0]] }), [
    ...settlements.slice(0, 4),
    pois[0],
    ...settlements.slice(4),
  ]);
  assert.deepEqual(campaignIconCandidates({ cells: pois }), pois);
  const forest = { ...base, key: '0,2', terrain: 'dense forest' };
  assert.deepEqual(campaignIconCandidates({ cells: [base, { ...base, water: 'ocean' }, forest] }), [
    forest,
  ]);
  assert.equal(chooseCampaignIcon({ cells: [] }), undefined);
  const older = { ...campaign };
  delete older.iconKey;
  assert.deepEqual(importCampaign(exportCampaign(older)), older);
  // Inspector choices can include any valid world hex, including open water.
  const manual = { ...campaign, iconKey: world.cells.find((cell) => cell.water)?.key ?? '0,0' };
  assert.deepEqual(importCampaign(exportCampaign(manual)), manual);
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
  const store = createCampaignStore(storage);
  const second = createCampaign(generateWorld('7'), colors, 'Custom');
  const deleted = { campaign, index: 0 };
  assert.equal(store.save([second], deleted), true);
  const reload = createCampaignStore(storage);
  assert.deepEqual(reload.campaigns, [second]);
  assert.deepEqual(reload.deletedCampaign, deleted);
  reload.campaigns.splice(reload.deletedCampaign.index, 0, reload.deletedCampaign.campaign);
  assert.equal(reload.save(reload.campaigns), true);
  assert.deepEqual(createCampaignStore(storage).campaigns, [campaign, second]);
  assert.equal(createCampaignStore(storage).deletedCampaign, null);
  assert.equal(reload.save([], { campaign, index: 0 }), true);
  const empty = createCampaignStore(storage);
  assert.deepEqual(empty.campaigns, []);
  assert.deepEqual(empty.deletedCampaign.campaign, campaign);
  assert.equal(createCampaignStore(undefined).deletedCampaign, null);
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
