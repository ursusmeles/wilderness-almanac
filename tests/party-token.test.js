import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { generateWorld } from '../src/generation/world.js';
import { distance } from '../src/generation/hex.js';
import { initialPartyToken, validatePartyToken } from '../src/application/party-token.js';
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
