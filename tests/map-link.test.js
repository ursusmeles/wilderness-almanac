import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readMapLink,
  mapLink,
  describeHex,
  copyText,
  shortCoordinates,
} from '../src/ui/map-link.js';

test('short hover coordinates retain one-based region IDs, negative and zero local axes', () => {
  assert.equal(shortCoordinates({ regionId: 1, x: 1, y: 2 }), '1/1,2');
  assert.equal(shortCoordinates({ regionId: 6, x: -4, y: 0 }), '6/-4,0');
  assert.equal(shortCoordinates(null), '');
});

test('clipboard writes receive the exact seed or share URL and report write failures', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const writes = [];
  const clipboard = {
    writeText: async (text) => {
      writes.push(text);
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  try {
    const seed = 'salt & ash';
    const url = mapLink('https://example.com/', {
      seed,
      variant: 2,
      colors: ['#282039', '#237d89', '#e5b96e'],
    });
    await copyText(seed);
    await copyText(url);
    assert.deepEqual(writes, [seed, url]);
    clipboard.writeText = async () => {
      throw new Error('Denied');
    };
    await assert.rejects(copyText(seed), /Denied/);
  } finally {
    Object.defineProperty(globalThis, 'navigator', original);
  }
});

test('map URLs round-trip arbitrary seeds, palette and dressing without dropping other URL state', () => {
  const state = {
    seed: 'Żmij & ash/?# + mist',
    variant: 48,
    colors: ['#282039', '#237d89', '#e5b96e'],
  };
  const link = mapLink('https://example.com/map?view=campaign#map', state);
  assert.deepEqual(readMapLink(link), state);
  assert.equal(new URL(link).searchParams.get('view'), 'campaign');
  assert.equal(new URL(link).hash, '#map');
  assert.deepEqual(readMapLink('https://example.com/?seed=other'), {
    seed: 'other',
    variant: undefined,
    colors: undefined,
  });
  for (const query of [
    'seed=%20',
    `seed=${'a'.repeat(129)}`,
    'variant=-1',
    'variant=1.5',
    'variant=9007199254740992',
    'colors=red-blue-green',
  ]) {
    const parsed = readMapLink(`https://example.com/?${query}`);
    assert.equal(parsed.seed, undefined);
    assert.equal(parsed.variant, undefined);
    assert.equal(parsed.colors, undefined);
  }
});

test('hex labels retain hierarchical coordinates and describe POIs and crossings', () => {
  const cell = {
    regionId: 2,
    x: 3,
    y: -1,
    terrain: 'meadow',
    pointsOfInterest: [{ kind: 'stronghold' }],
  };
  assert.equal(describeHex(cell), 'Region #2 · 3, -1 · Meadow with a stronghold');
  assert.match(
    describeHex({
      ...cell,
      pointOfLight: { type: 'village' },
      pointsOfInterest: [{ kind: 'watchtower', variant: 'lighthouse' }],
    }),
    /Village with a lighthouse$/,
  );
  assert.match(
    describeHex({
      ...cell,
      pointsOfInterest: [],
      terrain: 'river',
      crossing: { kind: 'bridge', material: 'stone' },
    }),
    /River with a stone bridge$/,
  );
});

test('POI labels identify lair, dungeon and mystic subtypes', () => {
  const expected = [
    ['lair', 'nest', 'a nest'],
    ['lair', 'cave', 'a cave lair'],
    ['dungeon', 'mine', 'a mine'],
    ['dungeon', 'dungeon', 'a dungeon entrance'],
    ['mystic', 'portal', 'a portal'],
    ['mystic', 'altar', 'an altar'],
    ['mystic', 'standing stone', 'standing stones'],
  ];
  for (const [kind, variant, name] of expected) {
    const label = describeHex({
      regionId: 1,
      x: 0,
      y: 0,
      terrain: 'dense forest',
      forest: { name: 'dense pine forest' },
      pointsOfInterest: [{ kind, variant }],
    });
    assert.equal(label, `Region #1 · 0, 0 · Dense pine forest with ${name}`);
  }
});
