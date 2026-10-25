import test from 'node:test';
import assert from 'node:assert/strict';
import { POI_TYPES, POI_VARIANTS } from '../src/generation/hex-edits.js';
import { POI_OPTIONS, poiValue, poiLabel, poiFromValue } from '../src/ui/poi-options.js';

test('combined POI choices round-trip named variants and hide cosmetic variant numbers', () => {
  assert.equal(poiLabel({ kind: 'mystic', variant: 'portal' }), 'Mystic · Portal');
  for (const [kind, variants] of Object.entries(POI_VARIANTS))
    for (const variant of variants) {
      const poi = { kind, variant };
      assert.deepEqual(poiFromValue(poiValue(poi)), poi);
      assert.ok(POI_OPTIONS.some(({ value }) => value === poiValue(poi)));
    }
  for (const kind of POI_TYPES.filter((kind) => !POI_VARIANTS[kind])) {
    assert.equal(POI_OPTIONS.filter(({ value }) => value.split(':')[0] === kind).length, 1);
    assert.equal(poiValue({ kind, variant: 0 }), poiValue({ kind, variant: 2 }));
    assert.deepEqual(poiFromValue(kind, { kind, variant: 2 }), { kind, variant: 2 });
  }
  assert.equal(poiFromValue(''), null);
  assert.equal(poiLabel(), 'None');
});
