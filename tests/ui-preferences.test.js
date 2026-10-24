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
      settingsOpen: true,
      panelOrder: ['inspector', 'tracker'],
      panelsCollapsed: { tracker: true, inspector: false },
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
    settingsOpen: true,
    panelOrder: ['inspector', 'tracker'],
    panelsCollapsed: { tracker: true, inspector: false },
  });
  assert.equal(readUIPreferences(storage).motion, false);
  saveUIPreferences(storage, {
    motion: 'yes',
    panelOrder: ['tracker', 'tracker'],
    panelsHorizontal: { tracker: true },
  });
  assert.deepEqual(readUIPreferences(storage), {});
});

test('restricted and malformed noncritical preferences fail harmlessly', () => {
  assert.equal(saveUIPreferences(undefined, {}), false);
  assert.deepEqual(readUIPreferences(undefined), {});
  for (const source of ['{broken', 'null', '{"version":99,"motion":true}'])
    assert.deepEqual(readUIPreferences({ getItem: () => source }), {});
});
