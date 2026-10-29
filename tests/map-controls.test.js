import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMapControls } from '../src/rendering/map-controls.js';

function fixture(t, party, touchMultiSelect = true) {
  const original = globalThis.ResizeObserver;
  const originalFrame = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const host = Object.assign(new EventTarget(), {
    clientWidth: 400,
    clientHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture() {},
  });
  const scene = new THREE.Scene();
  const map = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), material);
  mesh.userData.key = '0,0';
  const neighbour = new THREE.Mesh(mesh.geometry, material);
  neighbour.userData.key = '1,0';
  neighbour.position.x = 3;
  map.add(mesh, neighbour);
  scene.add(map);
  const selections = [];
  const hovers = [];
  const controls = createMapControls({
    host,
    scene,
    map,
    renderer: { setSize() {} },
    cells: [
      { key: '0,0', top: 0.5, g: mesh },
      { key: '1,0', top: 0.5, g: neighbour },
    ],
    materials: { line: material, hover: material },
    draw() {
      scene.updateMatrixWorld(true);
    },
    onSelect: (key, options) => selections.push({ key, ...options }),
    onHover: (key) => hovers.push(key),
    party,
    touchMultiSelect,
  });
  controls.refresh();
  t.after(() => {
    controls.dispose();
    mesh.geometry.dispose();
    material.dispose();
    globalThis.ResizeObserver = original;
    globalThis.requestAnimationFrame = originalFrame;
    globalThis.cancelAnimationFrame = originalCancel;
  });
  return {
    selections,
    hovers,
    frames,
    flushFrame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    controls,
    mesh,
    pointer(type, options = {}) {
      const { timeStamp, ...pointerOptions } = options;
      const event = Object.assign(new Event(type), {
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 200,
        clientY: 200,
        ctrlKey: false,
        metaKey: false,
        ...pointerOptions,
      });
      if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      host.dispatchEvent(event);
    },
  };
}

test('Command and Control map clicks request additive selection; plain clicks replace it', (t) => {
  const { pointer, selections } = fixture(t);
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }, {}]) {
    pointer('pointerdown', modifiers);
    pointer('pointerup', modifiers);
  }
  assert.deepEqual(selections, [
    { key: '0,0', additive: true, fromMap: true },
    { key: '0,0', additive: true, fromMap: true },
    { key: '0,0', additive: false, fromMap: true },
  ]);
});

test('ordinary touch taps select on release without waiting for the double-tap window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, selections } = fixture(t);
  pointer('pointerdown', { pointerType: 'touch', timeStamp: 0 });
  assert.deepEqual(selections, []);
  pointer('pointerup', { pointerType: 'touch', timeStamp: 40 });
  assert.deepEqual(selections, [{ key: '0,0', additive: false, fromMap: true }]);
  t.mock.timers.tick(300);
  assert.equal(selections.length, 1, 'no delayed duplicate selection');
});

test('a second touch tap does not repeat an immediate selection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, selections } = fixture(t);
  for (const timeStamp of [0, 100]) {
    pointer('pointerdown', { pointerType: 'touch', timeStamp });
    pointer('pointerup', { pointerType: 'touch', timeStamp: timeStamp + 40 });
  }
  t.mock.timers.tick(300);
  assert.deepEqual(selections, [{ key: '0,0', additive: false, fromMap: true }]);
});

test('double-tap slide still zooms after immediate selection without panning or selecting again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, selections, controls } = fixture(t);
  const position = controls.camera.position.clone();
  const zoom = controls.camera.zoom;
  pointer('pointerdown', { pointerType: 'touch', timeStamp: 0 });
  pointer('pointerup', { pointerType: 'touch', timeStamp: 40 });
  pointer('pointerdown', { pointerType: 'touch', timeStamp: 100 });
  pointer('pointermove', { pointerType: 'touch', clientY: 250, timeStamp: 180 });
  t.mock.timers.tick(600);
  pointer('pointerup', { pointerType: 'touch', clientY: 250, timeStamp: 700 });
  assert.ok(controls.camera.zoom > zoom);
  assert.ok(controls.camera.position.equals(position));
  assert.deepEqual(selections, [{ key: '0,0', additive: false, fromMap: true }]);
});

test('multiselect and party destinations wait for the zoom window before notifying selection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, selections, controls } = fixture(t);
  for (const [index, keys] of [[], ['1,0']].entries()) {
    controls.setSelection(keys);
    pointer('pointerdown', { pointerType: 'touch', timeStamp: index * 1000 });
    pointer('pointerup', { pointerType: 'touch', timeStamp: index * 1000 + 40 });
    assert.deepEqual(selections, []);
    t.mock.timers.tick(299);
    assert.deepEqual(selections, []);
    t.mock.timers.tick(1);
    assert.deepEqual(selections.pop(), { key: '0,0', additive: false, fromMap: true });
  }
});

test('double-tap slide does not toggle multiselect or request a party destination', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, selections, controls } = fixture(t);
  for (const [index, keys] of [[], ['1,0']].entries()) {
    controls.setSelection(keys);
    const zoom = controls.camera.zoom;
    const timeStamp = index * 1000;
    pointer('pointerdown', { pointerType: 'touch', timeStamp });
    pointer('pointerup', { pointerType: 'touch', timeStamp: timeStamp + 40 });
    pointer('pointerdown', { pointerType: 'touch', timeStamp: timeStamp + 100 });
    pointer('pointermove', { pointerType: 'touch', clientY: 250, timeStamp: timeStamp + 180 });
    t.mock.timers.tick(600);
    pointer('pointerup', { pointerType: 'touch', clientY: 250, timeStamp: timeStamp + 700 });
    assert.ok(controls.camera.zoom > zoom);
    assert.deepEqual(selections, []);
  }
});

test('interaction cancellation clears double-tap zoom recognition after immediate selection', (t) => {
  const { pointer, controls, selections } = fixture(t);
  pointer('pointerdown', { pointerType: 'touch', timeStamp: 0 });
  pointer('pointerup', { pointerType: 'touch', timeStamp: 40 });
  controls.cancelInteraction();
  const position = controls.camera.position.clone();
  const zoom = controls.camera.zoom;
  pointer('pointerdown', { pointerType: 'touch', timeStamp: 100 });
  pointer('pointermove', { pointerType: 'touch', clientY: 250, timeStamp: 180 });
  pointer('pointerup', { pointerType: 'touch', clientY: 250, timeStamp: 200 });
  assert.equal(controls.camera.zoom, zoom);
  assert.ok(!controls.camera.position.equals(position));
  assert.equal(selections.length, 1);
});

test('clicking or dragging the party never pans or selects the map', (t) => {
  let moved = false;
  const { pointer, selections, controls } = fixture(t, {
    start: () => {
      moved = false;
      return true;
    },
    move: () => {
      moved = true;
    },
    end: () => (moved ? null : '0,0'),
    cancel() {},
  });
  const position = controls.camera.position.clone();
  pointer('pointerdown');
  pointer('pointerup');
  assert.deepEqual(selections, []);
  selections.length = 0;
  pointer('pointerdown');
  pointer('pointermove', { clientX: 230 });
  pointer('pointerup', { clientX: 230 });
  assert.deepEqual(selections, []);
  assert.ok(controls.camera.position.equals(position));
});

test('modified drags, cancelled gestures and secondary clicks do not select hexes', (t) => {
  const { pointer, selections } = fixture(t);
  pointer('pointerdown', { metaKey: true });
  pointer('pointermove', { metaKey: true, clientX: 230 });
  pointer('pointerup', { metaKey: true, clientX: 230 });
  pointer('pointerdown', { metaKey: true });
  pointer('pointercancel');
  pointer('pointerup', { metaKey: true });
  pointer('pointerdown', { button: 2, ctrlKey: true });
  pointer('pointerup', { button: 2, ctrlKey: true });
  assert.deepEqual(selections, []);
});

test('arrow panning jumps two hex spacings at any zoom without changing selection or camera height', (t) => {
  const { controls, selections, pointer } = fixture(t);
  controls.select('1,0');
  const before = controls.camera.position.clone();
  const angle = controls.camera.quaternion.clone();
  const expected = 2 * Math.sqrt(3);
  for (const zoom of [0.7, 3, 12]) {
    controls.zoom(zoom / controls.camera.zoom);
    const beforeZoom = controls.camera.zoom;
    assert.equal(controls.pan(1, 0), true);
    assert.ok(Math.abs(controls.camera.position.distanceTo(before) - expected) < 1e-10);
    controls.pan(-1, 0);
    assert.ok(controls.camera.position.distanceTo(before) < 1e-10);
    controls.pan(0, 1);
    assert.ok(Math.abs(controls.camera.position.distanceTo(before) - expected) < 1e-10);
    controls.pan(0, -1);
    assert.equal(controls.camera.position.y, before.y);
    assert.ok(controls.camera.quaternion.equals(angle));
    assert.equal(controls.camera.zoom, beforeZoom);
  }
  assert.deepEqual(selections, [{ key: '1,0', additive: false }]);
  pointer('pointerdown');
  assert.equal(controls.pan(1, 0), false, 'an active map gesture blocks keyboard panning');
  assert.ok(controls.camera.position.distanceTo(before) < 1e-10);
  pointer('pointercancel');
});

test('explicit focus centres an elevated hex and zooms closer without changing selection or camera angle', (t) => {
  const { controls, mesh, selections } = fixture(t);
  mesh.position.set(7, 0, -3);
  controls.zoom(0.7);
  const beforeZoom = controls.camera.zoom;
  const angle = controls.camera.quaternion.clone();
  assert.equal(controls.focus('0,0'), true);
  const projected = new THREE.Vector3(7, 0.5, -3).project(controls.camera);
  assert.ok(Math.abs(projected.x) < 1e-10);
  assert.ok(Math.abs(projected.y) < 1e-10);
  assert.ok(controls.camera.zoom > beforeZoom && controls.camera.zoom <= 12);
  assert.ok(controls.camera.quaternion.equals(angle));
  assert.deepEqual(selections, []);

  controls.zoom(100);
  controls.focus('0,0');
  assert.equal(controls.camera.zoom, 12, 'an already closer view is retained');
  const position = controls.camera.position.clone();
  assert.equal(controls.focus('missing'), false);
  assert.ok(controls.camera.position.equals(position));
  assert.equal(controls.camera.zoom, 12);
});

test('touch hold adds an unselected hex once while keeping the previous selection', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, controls, selections } = fixture(t);
  controls.select('1,0');
  selections.length = 0;
  pointer('pointerdown', { pointerType: 'touch' });
  t.mock.timers.tick(549);
  assert.deepEqual(selections, []);
  t.mock.timers.tick(1);
  assert.deepEqual(selections, [{ key: '0,0', additive: true, fromMap: true }]);
  pointer('pointerup', { pointerType: 'touch' });
  assert.equal(selections.length, 1, 'release does not replace the additive selection');
});

test('touch holds on selected hexes or without a selection remain ordinary taps', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, controls, selections } = fixture(t);
  for (const keys of [[], ['0,0']]) {
    controls.setSelection(keys);
    pointer('pointerdown', { pointerType: 'touch' });
    t.mock.timers.tick(600);
    assert.equal(selections.length, 0);
    pointer('pointerup', { pointerType: 'touch' });
    t.mock.timers.tick(300);
    assert.deepEqual(selections.pop(), { key: '0,0', additive: false, fromMap: true });
  }
});

test('pan, pinch, cancellation and disposal cancel a pending touch hold', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, controls, selections } = fixture(t);
  controls.setSelection(['1,0']);
  pointer('pointerdown', { pointerType: 'touch' });
  pointer('pointermove', { pointerType: 'touch', clientX: 230 });
  pointer('pointermove', { pointerType: 'touch', clientX: 200 });
  t.mock.timers.tick(600);
  pointer('pointerup', { pointerType: 'touch' });
  assert.deepEqual(selections, []);

  pointer('pointerdown', { pointerType: 'touch' });
  pointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 230 });
  t.mock.timers.tick(600);
  pointer('pointerup', { pointerType: 'touch', pointerId: 2 });
  pointer('pointerup', { pointerType: 'touch' });
  assert.deepEqual(selections, []);

  pointer('pointerdown', { pointerType: 'touch' });
  pointer('pointercancel', { pointerType: 'touch' });
  t.mock.timers.tick(600);
  pointer('pointerup', { pointerType: 'touch' });
  assert.deepEqual(selections, []);

  pointer('pointerdown', { pointerType: 'touch' });
  controls.dispose();
  t.mock.timers.tick(600);
  assert.deepEqual(selections, []);
});

test('creation previews can retain ordinary touch selection without multiselect holds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pointer, controls, selections } = fixture(t, undefined, false);
  controls.setSelection(['1,0']);
  pointer('pointerdown', { pointerType: 'touch' });
  t.mock.timers.tick(600);
  assert.deepEqual(selections, []);
  pointer('pointerup', { pointerType: 'touch' });
  t.mock.timers.tick(300);
  assert.deepEqual(selections, [{ key: '0,0', additive: false, fromMap: true }]);
});

test('wheel zoom normalizes pixel, line and page units', (t) => {
  const { pointer, controls } = fixture(t);
  for (const [deltaMode, deltaY] of [
    [0, 48],
    [1, 3],
    [2, 0.12],
  ]) {
    const before = controls.camera.zoom;
    pointer('wheel', { deltaMode, deltaY });
    assert.ok(Math.abs(controls.camera.zoom / before - Math.exp(-0.048)) < 1e-10);
  }
});

test('hover raycasts once per frame, keeps the latest position, and cancels stale work', (t) => {
  const { pointer, mesh, hovers, flushFrame, frames, controls } = fixture(t);
  let casts = 0;
  const raycast = mesh.raycast;
  mesh.raycast = function (...args) {
    casts++;
    return raycast.apply(this, args);
  };
  hovers.length = 0;
  for (let i = 0; i < 20; i++) pointer('pointermove', { clientX: 2000 });
  pointer('pointermove', { clientX: 200 });
  assert.equal(casts, 0);
  assert.equal(frames.size, 1);
  flushFrame();
  assert.equal(casts, 1);
  assert.deepEqual(hovers, ['0,0']);
  pointer('pointermove');
  pointer('pointerleave');
  assert.equal(frames.size, 0);
  pointer('pointermove');
  pointer('pointerdown');
  assert.equal(frames.size, 0);
  pointer('pointerup');
  pointer('pointermove');
  controls.refresh();
  assert.equal(frames.size, 0);
  pointer('pointermove');
  controls.dispose();
  assert.equal(frames.size, 0);
});
