import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { generateWorld } from '../src/generation/world.js';
import { createCampaign } from '../src/application/campaigns.js';

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
  return {
    session,
    writes,
    fail: (value) => {
      outcome = value;
    },
  };
}

test('tracking and lock actions share world/dressing, retain immutable undo state and persist results', () => {
  const { session, writes } = fixture();
  const initial = session.snapshot();
  assert.equal(session.visit().ok, true);
  assert.equal(session.snapshot().world, initial.world);
  assert.equal(session.snapshot().dressing, initial.dressing);
  assert.equal(initial.campaign.hexEdits, undefined);
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
  assert.equal(next.campaign.hexEdits, undefined);
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
