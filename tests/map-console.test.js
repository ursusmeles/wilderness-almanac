import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapConsole } from '../src/ui/map-console.js';

function consoleFixture() {
  const pending = new Map();
  const announcements = [];
  let value;
  let nextId = 0;
  const status = createMapConsole({
    write: (text, kind) => (value = { text, kind }),
    announce: (text) => announcements.push(text),
    setTimer: (callback) => {
      pending.set(++nextId, callback);
      return nextId;
    },
    clearTimer: (id) => pending.delete(id),
  });
  return { status, pending, announcements, value: () => value };
}

test('action feedback survives hover updates, then restores the current coordinates or summary', () => {
  const f = consoleFixture();
  f.status.reset('469 hexes · 6 regions');
  f.status.hover('1/1,2');
  assert.deepEqual(f.value(), { text: '1/1,2', kind: 'coordinates' });
  assert.deepEqual(f.announcements, [], 'Hover does not flood the live announcement region');
  f.status.notify('Seed copied');
  f.status.hover('3/-2,0');
  assert.deepEqual(f.value(), { text: 'Seed copied', kind: 'action' });
  f.pending.values().next().value();
  assert.deepEqual(f.value(), { text: '3/-2,0', kind: 'coordinates' });
  f.status.hover();
  assert.deepEqual(f.value(), { text: '469 hexes · 6 regions', kind: 'summary' });
  assert.deepEqual(f.announcements, ['Seed copied']);
});

test('new actions replace expiry timers; world changes clear old coordinates and feedback', () => {
  const f = consoleFixture();
  f.status.notify('Wind turned off');
  f.status.notify('Palette changed');
  assert.equal(f.pending.size, 1);
  assert.deepEqual(f.value(), { text: 'Palette changed', kind: 'action' });
  f.status.hover('2/0,-3');
  f.status.reset('New world');
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.value(), { text: 'New world', kind: 'summary' });
  f.status.notify('Storage unavailable', 0);
  assert.equal(f.pending.size, 0);
  f.status.hover('1/0,0');
  assert.deepEqual(f.value(), { text: 'Storage unavailable', kind: 'action' });
  f.status.dispose();
});
