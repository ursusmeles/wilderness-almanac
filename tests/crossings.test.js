import test from 'node:test';
import assert from 'node:assert/strict';
import { crossingChoice, bridgeMaterialFor } from '../src/generation/crossings.js';

test('crossing roll includes the 20% no-crossing outcome', () => {
  const counts = { bridge: 0, ferry: 0, none: 0 };
  for (let seed = 1; seed <= 10000; seed++) {
    counts[crossingChoice(seed, { q: 1, r: 1 }, 0).kind ?? 'none']++;
  }
  for (const [kind, expected] of [
    ['bridge', 5000],
    ['ferry', 3000],
    ['none', 2000],
  ]) {
    assert.ok(Math.abs(counts[kind] - expected) < 150, `${kind}: ${counts[kind]}`);
  }
});

test('bridge material follows settlement size', () => {
  assert.equal(bridgeMaterialFor('small'), 'wood');
  for (const size of ['large', 'town', 'city']) assert.equal(bridgeMaterialFor(size), 'stone');
});
