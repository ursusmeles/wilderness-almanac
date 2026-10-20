import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStatus } from '../src/ui/save-status.js';
import { createMapConsole } from '../src/ui/map-console.js';

test('failed writes remain visible through action notices, hovering and map/menu changes', () => {
  let warning;
  let feedback;
  const status = createSaveStatus((next) => {
    warning = next;
  });
  const console = createMapConsole({
    write: (text) => {
      feedback = text;
    },
    setTimer: () => 0,
    clearTimer: () => {},
  });
  status.update('campaigns', false);
  const failure = warning;
  for (const action of ['Hex updated', 'Dressing regenerated', 'Seed copied', 'Wind turned on']) {
    console.notify(action);
    assert.equal(feedback, action);
    assert.equal(warning, failure);
    assert.equal(warning.campaigns, true);
  }
  console.hover('1/0,2');
  console.reset('469 hexes · 6 regions');
  assert.equal(warning, failure);
  status.update('campaigns', true);
  assert.equal(warning.message, '');
  console.dispose();
});

test('successful campaign writes do not dismiss an unsaved preferences warning, or vice versa', () => {
  let warning;
  const status = createSaveStatus((next) => {
    warning = next;
  });
  status.update('preferences', false);
  status.update('campaigns', false);
  status.update('preferences', true);
  assert.equal(warning.campaigns, true);
  assert.equal(warning.preferences, false);
  status.update('preferences', false);
  status.update('campaigns', true);
  assert.equal(warning.campaigns, false);
  assert.equal(warning.preferences, true);
  assert.match(warning.message, /settings aren't saved/);
  status.update('preferences', true);
  assert.equal(warning.message, '');
});
