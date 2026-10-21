import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapAction } from '../src/ui/map-action.js';

function fixture() {
  const frames = [];
  const attributes = new Map();
  const control = { disabled: true };
  const button = {
    disabled: false,
    childNodes: ['Apply changes'],
    textContent: 'Apply changes',
    classList: { add() {}, remove() {} },
    setAttribute: (key, value) => attributes.set(`button:${key}`, value),
    removeAttribute: (key) => attributes.delete(`button:${key}`),
    replaceChildren(...nodes) {
      this.textContent = nodes.join('');
    },
  };
  const root = {
    querySelectorAll: () => [button, control],
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  };
  const announced = [];
  return {
    frames,
    attributes,
    control,
    button,
    announced,
    action: createMapAction(root, (text) => announced.push(text)),
  };
}

test('Apply paints a busy state before work, blocks duplicate submissions and keeps new control states', async () => {
  const original = globalThis.requestAnimationFrame;
  const { frames, attributes, control, button, announced, action } = fixture();
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    let calls = 0;
    const pending = action.run(button, () => {
      calls++;
      assert.equal(action.isBusy(), true);
      assert.equal(attributes.get('aria-busy'), 'true');
      control.disabled = false;
      button.disabled = true;
      return true;
    });
    assert.equal(button.textContent, 'Applying…');
    assert.equal(button.disabled, true);
    assert.equal(attributes.get('button:aria-busy'), 'true');
    assert.equal(await action.run(button, () => calls++), false);
    frames.shift()();
    assert.equal(calls, 0);
    frames.shift()();
    assert.equal(await pending, true);
    assert.equal(calls, 1);
    assert.equal(action.isBusy(), false);
    assert.equal(control.disabled, false);
    assert.equal(button.disabled, true);
    assert.equal(attributes.has('aria-busy'), false);
    assert.equal(button.textContent, 'Apply changes');
    assert.deepEqual(announced, ['Applying…']);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('disposing before the painted frame cancels work and restores controls', async () => {
  const original = globalThis.requestAnimationFrame;
  const { frames, button, action } = fixture();
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    let calls = 0;
    const pending = action.run(button, () => calls++);
    action.dispose();
    frames.shift()();
    frames.shift()();
    assert.equal(await pending, false);
    assert.equal(calls, 0);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Apply changes');
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});
