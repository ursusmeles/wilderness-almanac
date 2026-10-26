import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readUIPreferences,
  saveUIPreferences,
  UI_PREFERENCES_KEY,
} from '../src/ui/ui-preferences.js';

test('localStorage only receives validated noncritical UI preferences', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(
    saveUIPreferences(storage, {
      motion: false,
      defaultTimeOfDay: 'night',
      settingsOpen: true,
      panelOrder: ['inspector', 'tracker'],
      panelsCollapsed: { tracker: true, inspector: false },
      campaignPanels: {
        adventure: {
          panelOrder: ['tracker', 'inspector'],
          panelsCollapsed: { tracker: true, inspector: false },
          panelsHorizontal: { tracker: false, inspector: true },
          seed: 'critical',
        },
      },
      seed: 'critical',
      variant: 3,
      campaignId: 'id',
      colors: ['#123456'],
      palettes: [{ name: 'critical' }],
      defaultPalette: 'custom:critical',
    }),
    true,
  );
  assert.deepEqual(JSON.parse(values.get(UI_PREFERENCES_KEY)), {
    version: 1,
    motion: false,
    defaultTimeOfDay: 'night',
    settingsOpen: true,
    campaignPanels: {
      adventure: {
        panelOrder: ['tracker', 'inspector'],
        panelsCollapsed: { tracker: true, inspector: false },
        panelsHorizontal: { tracker: false, inspector: true },
      },
    },
  });
  assert.equal(readUIPreferences(storage).motion, false);
  saveUIPreferences(storage, {
    motion: 'yes',
    defaultTimeOfDay: 'midnight',
    panelOrder: ['tracker', 'tracker'],
    panelsHorizontal: { tracker: true },
  });
  assert.deepEqual(readUIPreferences(storage), {});
});

test('campaign panel layouts stay separate and ignore legacy global layouts and invalid entries', () => {
  let source = JSON.stringify({
    version: 1,
    panelOrder: ['tracker', 'inspector'],
    panelsCollapsed: { tracker: true, inspector: true },
    panelsHorizontal: { tracker: true, inspector: true },
    campaignPanels: {
      first: { panelsCollapsed: { tracker: false, inspector: true } },
      second: { panelsHorizontal: { tracker: true, inspector: false } },
      invalid: { panelOrder: ['tracker', 'tracker'], panelsCollapsed: { tracker: 'yes' } },
      null: null,
      array: [],
      '': { panelOrder: ['inspector', 'tracker'] },
      ['x'.repeat(129)]: { panelOrder: ['inspector', 'tracker'] },
    },
  });
  const storage = { getItem: () => source, setItem: (_, value) => (source = value) };
  const expected = {
    campaignPanels: {
      first: { panelsCollapsed: { tracker: false, inspector: true } },
      second: { panelsHorizontal: { tracker: true, inspector: false } },
    },
  };
  assert.deepEqual(readUIPreferences(storage), expected);
  assert.equal(saveUIPreferences(storage, expected), true);
  assert.deepEqual(readUIPreferences(storage), expected);
  assert.equal(readUIPreferences(storage).campaignPanels.third, undefined);
  for (const campaignPanels of [null, [], 'invalid']) {
    source = JSON.stringify({ version: 1, campaignPanels });
    assert.deepEqual(readUIPreferences(storage), {});
  }
});

test('restricted and malformed noncritical preferences fail harmlessly', () => {
  assert.equal(saveUIPreferences(undefined, {}), false);
  assert.deepEqual(readUIPreferences(undefined), {});
  for (const source of ['{broken', 'null', '{"version":99,"motion":true}'])
    assert.deepEqual(readUIPreferences({ getItem: () => source }), {});
});

test('earlier UI namespaces retain preferences until a current preference is saved', () => {
  const values = new Map([
    ['previous-product:ui-v1', JSON.stringify({ version: 1, motion: false, seed: 'private' })],
  ]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index],
  };
  assert.deepEqual(readUIPreferences(storage), { motion: false });
  values.set('other-product:ui-v1', JSON.stringify({ version: 1, motion: true }));
  assert.deepEqual(readUIPreferences(storage), {});
  assert.equal(saveUIPreferences(storage, { motion: true }), true);
  assert.deepEqual(readUIPreferences(storage), { motion: true });
  assert.equal(values.has('previous-product:ui-v1'), true);
});
