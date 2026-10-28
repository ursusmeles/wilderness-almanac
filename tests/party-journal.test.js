import test from 'node:test';
import assert from 'node:assert/strict';
import {
  journalCommand,
  rollDice,
  mentionOptions,
  characterCount,
  validateJournal,
  ORACLE_ANSWERS,
  isClearableJournalRoll,
} from '../src/application/party-journal.js';
import { createCampaignSession } from '../src/application/campaign-session.js';
import {
  createCampaign,
  exportCampaign,
  importCampaign,
  validateCampaign,
} from '../src/application/campaigns.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { mapLink, readMapLink } from '../src/ui/map-link.js';

const fixture = () => {
  const writes = [];
  const world = generateWorld('heliotest');
  const campaign = createCampaign(world, ['#cdab8f', '#0b365e', '#11b329'], 'Forbidden Lands');
  const session = createCampaignSession({
    persist: (record) => {
      writes.push(record);
      return { campaignSaved: true, preferencesSaved: true };
    },
  });
  session.open(campaign, world);
  return { session, writes, world, campaign };
};

test('heliotest has the clockwise seven-hex layout, fixed dressing and a portable replay', () => {
  const { session, world } = fixture();
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  assert.equal(world.cells.length, 7);
  const clockwise = ['0,-1', '1,-1', '1,0', '0,1', '-1,1', '-1,0'];
  assert.deepEqual(
    clockwise.map((key) => byKey.get(key).elevation),
    [4, 3, 2, 0, 0, 1],
  );
  assert.deepEqual(
    clockwise.map((key) => byKey.get(key).terrain),
    ['mountains', 'dense forest', 'light forest', 'open water', 'meadow', 'farmlands'],
  );
  assert.equal(byKey.get('0,0').elevation, 1);
  assert.equal(byKey.get('0,0').pointOfLight.type, 'town');
  assert.equal(byKey.get('0,0').name, undefined);
  assert.equal(byKey.get('0,0').pointOfLight.name, undefined);
  assert.equal(byKey.get('0,-1').pointsOfInterest[0].variant, 'nest');
  assert.equal(byKey.get('1,0').pointsOfInterest[0].kind, 'abbey');
  assert.equal(byKey.get('-1,0').pointsOfInterest[0].kind, 'encampment');
  for (const variant of [0, 1]) {
    const layout = prepareMap(world, generateDressing(world, variant));
    assert.equal(layout.find((cell) => cell.key === '1,-1').forest.type, 'pine');
    assert.equal(layout.find((cell) => cell.key === '1,0').forest.type, 'ash');
    assert.ok(
      layout
        .find((cell) => cell.key === '-1,0')
        .props.some((prop) => prop.cropStyle === 'vineyard'),
    );
  }
  const saved = importCampaign(exportCampaign(session.snapshot().campaign));
  assert.deepEqual(generateWorld(saved.seed, { generatorVersion: saved.generatorVersion }), world);
  const linked = readMapLink(mapLink('https://example.com', saved));
  assert.deepEqual(generateWorld(linked.seed, linked), world);
  assert.equal(generateWorld('heliotest', { generatorVersion: 9 }).cells.length, 469);
  const v9 = generateWorld('7', { generatorVersion: 9 });
  assert.deepEqual({ ...generateWorld('7'), generatorVersion: 9 }, v9);
});

test('journal regeneration retains identity, week, question and references; deletion never reuses IDs', () => {
  const { session, writes } = fixture();
  const command = '/oracle -1 @Adventurers safe?';
  session.addJournal(command, [{ type: 'party', key: 'party', start: 11, end: 23 }], () => 0);
  const first = session.snapshot().campaign.journal[0];
  session.nextWeek();
  assert.equal(session.regenerateJournal(first.id, () => 0.999).ok, true);
  const regenerated = session.snapshot().campaign.journal[0];
  assert.equal(regenerated.id, first.id);
  assert.equal(regenerated.week, 1);
  assert.match(regenerated.text, /^@Adventurers safe\?\nOracle: Yes /);
  assert.deepEqual(regenerated.mentions, first.mentions);
  assert.equal(regenerated.command, command);
  assert.deepEqual(regenerated.commandMentions, first.commandMentions);
  assert.deepEqual(
    importCampaign(exportCampaign(session.snapshot().campaign)),
    validateCampaign(session.snapshot().campaign),
  );
  const week = session.snapshot().campaign.journal[1];
  const count = writes.length;
  assert.equal(session.regenerateJournal(week.id).ok, false);
  assert.equal(writes.length, count);
  assert.equal(session.deleteJournal(week.id).ok, false);
  assert.equal(writes.length, count);
  assert.equal(session.snapshot().campaign.partyToken.weeks, 2);
  session.moveParty('1,0');
  const move = session.snapshot().campaign.journal.at(-1);
  assert.equal(session.deleteJournal(move.id).ok, false);
  session.addJournal('/d6', [], () => 0);
  const deleted = session.snapshot().campaign.journal.at(-1);
  assert.equal(session.deleteJournal(deleted.id).ok, true);
  session.addJournal('Keep this note');
  assert.ok(session.snapshot().campaign.journal.at(-1).id > deleted.id);
  session.undo();
  assert.equal(session.snapshot().campaign.journal.at(-1).text, 'Keep this note');
  const saved = session.snapshot().campaign;
  for (const entry of saved.journal) session.deleteJournal(entry.id);
  const restored = importCampaign(exportCampaign(session.snapshot().campaign));
  assert.deepEqual(
    restored.journal.map((entry) => entry.kind),
    ['week'],
  );
  session.open(restored);
  session.addJournal('/1d20', [], () => 0);
  assert.ok(session.snapshot().campaign.journal.at(-1).id > deleted.id);
});

test('legacy printed rolls can be regenerated while malformed command metadata is rejected', () => {
  const { session, campaign } = fixture();
  const entries = [
    { id: 1, week: 1, kind: 'roll', text: '2d6+1: 6 + 2 + 1 = 9', mentions: [] },
    { id: 2, week: 1, kind: 'abstract', text: 'Abstract: The Fool', mentions: [] },
    {
      id: 3,
      week: 1,
      kind: 'oracle',
      text: 'Are we safe?\nOracle: No (d6: 3 − 1 = 2)',
      mentions: [],
    },
  ];
  session.open({ ...campaign, journal: entries });
  for (const entry of entries)
    assert.equal(session.regenerateJournal(entry.id, () => 0.999).ok, true);
  const journal = session.snapshot().campaign.journal;
  assert.equal(journal[0].text, '2d6+1: 6 + 6 + 1 = 13');
  assert.equal(journal[1].text, 'Abstract: The World');
  assert.match(journal[2].text, /^Are we safe\?\nOracle: Yes /);
  assert.throws(() => validateJournal([{ ...entries[0], command: '/help' }]));
});

test('events save with actions, retain historical names, and movement Undo keeps later notes and weeks', () => {
  const { session, writes } = fixture();
  assert.equal(session.snapshot().campaign.partyToken.key, '0,0');
  assert.equal(session.snapshot().campaign.partyToken.weeks ?? 1, 1);
  assert.equal(session.moveParty('1,0').ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes.at(-1).hexEdits.cells['1,0'].visited, true);
  assert.match(
    writes.at(-1).journal[0].text,
    /^Adventurers travelled to Light ash forest with an abbey\.$/,
  );
  session.partyDetails({ name: 'Ash walkers' });
  session.nextWeek();
  session.addJournal('A saved note');
  const journal = session.snapshot().campaign.journal;
  assert.deepEqual(
    journal.map((entry) => [entry.kind, entry.week]),
    [
      ['move', 1],
      ['rename', 1],
      ['week', 2],
      ['note', 2],
    ],
  );
  assert.equal(journal[1].text, 'Adventurers changed name to Ash walkers.');
  assert.equal(journal[2].text, 'Ash walkers lived another week.');
  assert.equal(session.undo().ok, true);
  const saved = session.snapshot().campaign;
  assert.equal(saved.partyToken.key, '0,0');
  assert.equal(saved.partyToken.weeks, 2);
  assert.equal(saved.partyToken.name, 'Ash walkers');
  assert.deepEqual(
    saved.journal.map((entry) => entry.kind),
    ['rename', 'week', 'note'],
  );
  assert.deepEqual(importCampaign(exportCampaign(saved)), validateCampaign(saved));
  const before = writes.length;
  session.addJournal('/help');
  session.addJournal('/explore');
  session.moveParty('0,0');
  assert.equal(writes.length, before);
  assert.equal(JSON.parse(exportCampaign(saved)).version, 3);
});

test('dice parse mixed terms, preserve separate totals, validate the whole command before rolling and reject code', () => {
  const faces = [5 / 6, 1 / 6];
  const [roll] = rollDice('2d6+1', () => faces.shift());
  assert.equal(roll.calculation, '6 + 2 + 1');
  assert.equal(roll.total, 9);
  assert.deepEqual(
    rollDice('d4+2d6-d8+1 4d6 1d20', () => 0).map((roll) => roll.total),
    [3, 4, 1],
  );
  for (const command of [
    '1000000d6',
    '0d6',
    '2d100',
    '2d6+alert(1)',
    '2d6++1',
    '4',
    '2d6+Infinity',
    '2d6 +1',
  ])
    assert.throws(() => rollDice(command));
  let calls = 0;
  assert.throws(() =>
    rollDice('2d6 0d20', () => {
      calls++;
      return 0;
    }),
  );
  assert.equal(calls, 0);
  const { session } = fixture();
  session.addJournal('/2d6+1', [], () => 0);
  const saved = importCampaign(exportCampaign(session.snapshot().campaign));
  session.open(saved);
  assert.equal(session.snapshot().campaign.journal[0].text, '2d6+1: 1 + 1 + 1 = 3');
});

test('oracle clamps modifiers, preserves questions and references; abstract draws from Major Arcana', () => {
  for (let face = 1; face <= 6; face++)
    assert.match(
      journalCommand('/oracle', [], () => (face - 1) / 6).text,
      new RegExp(ORACLE_ANSWERS[face - 1]),
    );
  assert.match(
    journalCommand('/oracle -100 Is it safe?', [], () => 0.99).text,
    /^Is it safe\?\nOracle: No, and….* = -94 → 1\)/,
  );
  assert.match(journalCommand('/oracle +100', [], () => 0).text, /Yes, and….* = 101 → 6\)/);
  const input = '/oracle -1 @Adventurers safe?';
  const result = journalCommand(
    input,
    [{ type: 'party', key: 'party', start: 11, end: 23 }],
    () => 0.5,
  );
  assert.deepEqual(result.mentions, [{ type: 'party', key: 'party', start: 0, end: 12 }]);
  assert.equal(journalCommand('/abstract', [], () => 0).text, 'Abstract: The Fool');
  assert.equal(journalCommand('/abstract', [], () => 0.999).text, 'Abstract: The World');
});

test('plain text, Unicode character limits, structured references and visited-first autocomplete are bounded', () => {
  assert.equal(characterCount('👨‍👩‍👧‍👦'), 1);
  const text = '<img src=x onerror=alert(1)> & "plain"';
  assert.equal(journalCommand(text).text, text);
  assert.doesNotThrow(() => journalCommand('🌿'.repeat(300)));
  assert.throws(() => journalCommand('🌿'.repeat(301)), /300 characters/);
  assert.throws(() =>
    validateJournal([
      {
        id: 1,
        week: 1,
        kind: 'note',
        text: 'x',
        mentions: [{ type: 'hex', key: '99,99', start: 0, end: 1 }],
      },
    ]),
  );
  assert.throws(() => validateJournal([{ id: 1, week: 1, kind: 'code', text: 'x' }]));
  const { session, world } = fixture();
  session.moveParty('1,0');
  const campaign = session.snapshot().campaign;
  assert.deepEqual(
    new Set(
      mentionOptions('$', '', campaign, world)
        .slice(0, 2)
        .map((option) => option.key),
    ),
    new Set(['0,0', '1,0']),
  );
  assert.equal(mentionOptions('$', 'abbey', campaign, world)[0].key, '1,0');
  assert.equal(mentionOptions('$', '1,0', campaign, world)[0].key, '1,0');
  assert.equal(mentionOptions('@', 'party', campaign, world)[0].label, '@Adventurers');
  assert.deepEqual(mentionOptions('#', '2', campaign, world), []);
  session.nextWeek();
  assert.equal(mentionOptions('#', '2', session.snapshot().campaign, world)[0].label, 'Week 2');
  const hidden = {
    ...world,
    cells: world.cells.map((cell) => ({ ...cell, fogState: 'undiscovered' })),
  };
  assert.deepEqual(mentionOptions('$', '', campaign, hidden), []);
  assert.deepEqual(
    validateCampaign({ ...campaign, journal: [] }),
    validateCampaign({ ...campaign, journal: undefined }),
  );
  assert.throws(
    () => validateCampaign({ ...campaign, partyToken: { ...campaign.partyToken, key: '2,0' } }),
    /outside the heliotest map/,
  );
  assert.throws(
    () =>
      validateCampaign({
        ...campaign,
        journal: [{ id: 1, week: 3, kind: 'note', text: 'Future', mentions: [] }],
      }),
    /future week/,
  );
});

test('manual edits and entries on earlier week pages retain their week, identity and references', () => {
  const { session } = fixture();
  session.nextWeek();
  session.nextWeek();
  const note = 'Remember Week 1';
  const mentions = [{ type: 'week', key: '1', start: 9, end: 15 }];
  assert.equal(session.addJournal(note, mentions, undefined, { week: 1 }).ok, true);
  const original = session.snapshot().campaign.journal.at(-1);
  assert.equal(original.week, 1);
  assert.equal(session.editJournal(original.id, `${note}.`, mentions).ok, true);
  const edited = session.snapshot().campaign.journal.at(-1);
  assert.equal(edited.id, original.id);
  assert.equal(edited.week, 1);
  assert.deepEqual(edited.mentions, mentions);
  assert.equal(edited.text, 'Remember Week 1.');
  assert.equal(session.snapshot().campaign.partyToken.weeks, 3);
  assert.equal(session.editJournal(original.id, 'x'.repeat(301)).ok, false);
  assert.equal(
    session.editJournal(session.snapshot().campaign.journal[0].id, 'Rewrite history').ok,
    false,
  );
  assert.equal(session.addJournal('Future', [], undefined, { week: 4 }).ok, false);
  assert.equal(session.snapshot().campaign.journal.length, 3);
  const saved = session.snapshot().campaign;
  assert.deepEqual(importCampaign(exportCampaign(saved)), validateCampaign(saved));
});

test('/clear removes only standalone rolls across weeks without logging an entry or reusing IDs', () => {
  const { session, writes } = fixture();
  session.moveParty('1,0');
  session.partyDetails({ name: 'Ash walkers' });
  session.addJournal(
    '/oracle -1 Is @Ash walkers safe?',
    [{ type: 'party', key: 'party', start: 14, end: 26 }],
    () => 0,
  );
  session.addJournal('/oracle +1', [], () => 0);
  session.addJournal('/2d6+1 1d20-d4', [], () => 0);
  session.nextWeek();
  session.addJournal('/abstract', [], () => 0);
  session.addJournal('A note to keep');
  session.addJournal('/oracle -100', [], () => 0);
  const before = session.snapshot().campaign;
  const sequence = before.journalSequence;
  const kept = before.journal.filter(
    (entry) =>
      !['roll', 'abstract'].includes(entry.kind) &&
      !(entry.kind === 'oracle' && !entry.text.startsWith('Is ')),
  );
  const count = writes.length;
  const result = session.addJournal('/clear');
  assert.equal(result.ok, true);
  assert.equal(result.clear, true);
  assert.equal(result.removed, 4);
  assert.equal(writes.length, count + 1);
  assert.deepEqual(session.snapshot().campaign.journal, kept);
  assert.equal(session.snapshot().campaign.partyToken.weeks, 2);
  assert.equal(session.snapshot().campaign.journalSequence, sequence);
  for (const entry of kept.filter((entry) => ['move', 'rename', 'week'].includes(entry.kind)))
    assert.equal(session.deleteJournal(entry.id).ok, false);
  assert.equal(writes.length, count + 1);
  const saved = importCampaign(exportCampaign(session.snapshot().campaign));
  session.open(saved);
  assert.equal(session.addJournal('/clear').removed, 0);
  const noChangeWrites = writes.length;
  assert.equal(session.addJournal('/clear').ok, true);
  assert.equal(writes.length, noChangeWrites);
  session.addJournal('/d6', [], () => 0);
  assert.ok(session.snapshot().campaign.journal.at(-1).id > sequence);
});

test('/clear preserves attached text in imported results, including older entries without commands', () => {
  for (const source of ['/abstract', '/oracle', '/oracle -10', '/d6', '/2d6+1 1d20-d4']) {
    const entry = journalCommand(source, [], () => 0);
    assert.equal(isClearableJournalRoll(entry), true, source);
    assert.equal(isClearableJournalRoll({ ...entry, text: `${entry.text}.` }), true, source);
    assert.equal(
      isClearableJournalRoll({ ...entry, text: `${entry.text}\nA note to keep.` }),
      false,
      source,
    );
    assert.equal(
      isClearableJournalRoll({ ...entry, text: `${entry.text} A note to keep.` }),
      false,
      source,
    );
  }
  assert.equal(isClearableJournalRoll(journalCommand('/oracle Will it rain?', [], () => 0)), false);
  assert.equal(isClearableJournalRoll({ kind: 'note', text: 'Abstract: The Fool' }), false);
});
