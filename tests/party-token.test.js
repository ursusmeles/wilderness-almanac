import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { generateWorld } from '../src/generation/world.js';
import { distance } from '../src/generation/hex.js';
import {
  initialPartyToken,
  validatePartyToken,
  partyMetadata,
} from '../src/application/party-token.js';
import { partyColor } from '../src/rendering/party-color.js';
import { palettes } from '../src/palette.js';

const world = generateWorld('7');
const campaign = createCampaign(world, palettes.forbidden, 'Forbidden Lands');
test('existing campaigns gain a default Warden at the nearest settlement without mutating the source', () => {
  const writes = [];
  const session = createCampaignSession({
    persist: (value) => {
      writes.push(value);
      return { campaignSaved: true, preferencesSaved: true };
    },
  });
  session.open(campaign, world);
  const { campaign: record } = session.snapshot();
  assert.equal(record.partyToken.style, 'warden');
  const start = world.cells.find((cell) => cell.key === record.partyToken.key);
  assert.ok(start.pointOfLight);
  assert.equal(
    distance(start),
    Math.min(...world.cells.filter((cell) => cell.pointOfLight).map((cell) => distance(cell))),
  );
  assert.equal(record.hexEdits.cells[start.key].visited, true);
  assert.equal(campaign.partyToken, undefined);
  assert.equal(campaign.hexEdits, undefined);
  assert.equal(writes.length, 1);
  assert.equal(session.snapshot().canUndo, false);
});
test('placement saves party and visited flags atomically, shares geometry and undoes as one action', () => {
  let saved = true;
  const session = createCampaignSession({
    persist: () => ({ campaignSaved: saved, preferencesSaved: true }),
  });
  session.open(campaign, world);
  const before = session.snapshot();
  const target = world.cells.find(
    (cell) => !cell.water && cell.key !== before.campaign.partyToken.key,
  );
  session.moveParty(target.key);
  const after = session.snapshot();
  assert.equal(after.campaign.partyToken.key, target.key);
  assert.equal(after.campaign.hexEdits.cells[target.key].visited, true);
  assert.equal(after.world, before.world);
  assert.equal(after.dressing, before.dressing);
  assert.equal(after.selected, before.selected);
  for (const style of ['cairn', 'warden', 'waystone']) {
    session.partyStyle(style);
    const imported = importCampaign(exportCampaign(session.snapshot().campaign));
    assert.equal(imported.partyToken.style, style);
    assert.equal(imported.partyToken.key, target.key);
  }
  session.undo();
  assert.equal(session.snapshot().campaign.partyToken.key, before.campaign.partyToken.key);
  assert.equal(session.snapshot().campaign.partyToken.style, 'waystone');
  assert.deepEqual(session.snapshot().campaign.hexEdits, before.campaign.hexEdits);
  saved = false;
  session.moveParty(target.key);
  assert.equal(session.snapshot().campaign.partyToken.key, target.key);
  assert.equal(session.snapshot().persistence.saved, false);
  assert.equal(session.moveParty('99,99').ok, false);
});
test('party import rejects malformed keys and styles; settlement-free maps fall back to central dry land', () => {
  for (const value of [
    null,
    { key: '0,0', style: 'warder' },
    { key: '13,0', style: 'warden' },
    { key: '-0,0', style: 'warden' },
    { key: '0,0', style: '<script>' },
  ])
    assert.throws(() => validatePartyToken(value), /invalid party/);
  assert.deepEqual(
    initialPartyToken({
      cells: [
        { key: '1,0', q: 1, r: 0 },
        { key: '0,0', q: 0, r: 0, water: 'ocean' },
      ],
    }),
    { key: '1,0', style: 'warden' },
  );
  assert.throws(
    () =>
      importCampaign(exportCampaign({ ...campaign, partyToken: { key: '0,0', style: 'invalid' } })),
    /invalid party/,
  );
  assert.equal(partyColor(palettes.forbidden), '#ef365c');
  assert.equal(partyColor(palettes.autumn), '#13d9f2');
});

test('party and hex selections are exclusive, ephemeral and do not save or add Undo history', () => {
  let writes = 0;
  const session = createCampaignSession({
    persist: () => {
      writes++;
      return { campaignSaved: true, preferencesSaved: true };
    },
  });
  session.open(campaign, world);
  session.setMultiEdit(true);
  session.select('1,0');
  session.selectParty();
  assert.equal(session.snapshot().partySelected, true);
  assert.equal(session.snapshot().multiEdit, false);
  assert.deepEqual(session.snapshot().selectedKeys, []);
  session.select('0,0');
  assert.equal(session.snapshot().partySelected, false);
  session.selectParty();
  session.setMultiEdit(true);
  assert.equal(session.snapshot().partySelected, false);
  assert.equal(writes, 1);
  assert.equal(session.snapshot().canUndo, false);
});

test('party profile edits survive export, reload and hex Undo without changing geometry', () => {
  const session = createCampaignSession({
    persist: () => ({ campaignSaved: true, preferencesSaved: true }),
  });
  session.open(campaign, world);
  const initial = session.snapshot();
  session.moveParty('0,0');
  assert.equal(
    session.partyDetails({
      name: '  Wayfarers  ',
      color: '#13d9f2',
      style: 'cairn',
      daysTravelled: 3,
      sessionsPlayed: 2,
    }).ok,
    true,
  );
  assert.equal(session.snapshot().world, initial.world);
  assert.equal(session.snapshot().dressing, initial.dressing);
  session.undo();
  const imported = importCampaign(exportCampaign(session.snapshot().campaign));
  session.open(imported, world);
  assert.equal(session.snapshot().campaign.partyToken.name, 'Wayfarers');
  assert.equal(session.snapshot().campaign.partyToken.color, '#13d9f2');
  assert.equal(session.snapshot().campaign.partyToken.daysTravelled, 3);
  assert.equal(session.snapshot().campaign.partyToken.sessionsPlayed, 2);
  assert.equal(session.partyDetails({ name: ' ' }).ok, false);
  assert.equal(session.partyDetails({ color: 'invalid' }).ok, false);
  assert.equal(session.partyDetails({ daysTravelled: 0 }).ok, false);
});

test('party metadata includes the current settlement, POI name and only non-open-water visited coverage', () => {
  const cells = [
    {
      key: '0,0',
      q: 0,
      r: 0,
      terrain: 'meadow',
      pointOfLight: { id: 'town' },
      pointsOfInterest: [],
    },
    {
      key: '1,0',
      q: 1,
      r: 0,
      terrain: 'river',
      water: 'river',
      pointsOfInterest: [{ kind: 'dungeon', variant: 'mine', name: 'Copper Mine' }],
    },
    { key: '2,0', q: 2, r: 0, terrain: 'meadow', pointsOfInterest: [] },
    { key: '-1,0', q: -1, r: 0, terrain: 'open water', water: 'ocean', pointsOfInterest: [] },
    { key: '0,-1', q: 0, r: -1, terrain: 'open water', water: 'lake', pointsOfInterest: [] },
  ];
  const record = {
    partyToken: { key: '0,0', style: 'warden' },
    hexEdits: {
      cells: Object.fromEntries(
        cells.filter((cell) => cell.key !== '2,0').map((cell) => [cell.key, { visited: true }]),
      ),
    },
  };
  const metadata = partyMetadata({ cells }, record);
  assert.equal(metadata.settlement, 0);
  assert.equal(metadata.settlementKey, '0,0');
  assert.deepEqual(metadata.poi, { key: '1,0', name: 'Copper Mine', distance: 1 });
  assert.equal(metadata.visited, 2);
  assert.deepEqual(metadata.visitedKeys, ['0,0', '1,0']);
  assert.equal(metadata.land, 3);
  assert.equal(metadata.percent, 67);
  assert.equal(metadata.days, 1);
  assert.equal(metadata.sessions, 1);
  const empty = partyMetadata({ cells: [cells[3]] }, { ...record, partyToken: { key: '-1,0' } });
  assert.equal(empty.percent, 0);
  assert.equal(empty.poi, null);
  assert.equal(empty.settlement, null);
  assert.equal(empty.settlementKey, null);
  assert.deepEqual(empty.visitedKeys, []);
});

test('selecting visited hexes replaces party selection with exactly the counted land hexes without saving', () => {
  let writes = 0;
  const session = createCampaignSession({
    persist: () => {
      writes++;
      return { campaignSaved: true, preferencesSaved: true };
    },
  });
  const land = world.cells.find((cell) => !cell.water);
  const river = world.cells.find((cell) => cell.water === 'river');
  const water = world.cells.find((cell) => ['ocean', 'lake'].includes(cell.water));
  const record = {
    ...campaign,
    partyToken: { key: land.key, style: 'warden' },
    hexEdits: {
      version: 1,
      cells: Object.fromEntries([land, river, water].map((cell) => [cell.key, { visited: true }])),
    },
  };
  session.open(record, world);
  session.selectParty();
  const before = session.snapshot();
  assert.equal(session.selectVisited(), true);
  const after = session.snapshot();
  assert.equal(after.partySelected, false);
  assert.equal(after.multiEdit, true);
  assert.deepEqual(new Set(after.selectedKeys), new Set([land.key, river.key]));
  assert.equal(after.selected, after.selectedKeys[0]);
  assert.equal(after.campaign, before.campaign);
  assert.equal(after.canUndo, false);
  assert.equal(writes, 1);

  session.open({ ...record, hexEdits: { version: 1, cells: {} } }, world);
  session.selectParty();
  assert.equal(session.selectVisited(), false);
  assert.equal(session.snapshot().partySelected, true);
  assert.equal(session.snapshot().multiEdit, false);
  assert.equal(writes, 2);
});
