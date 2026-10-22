import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMapControls } from '../src/rendering/map-controls.js';

function fixture(t) {
  const original = globalThis.ResizeObserver;
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
  map.add(mesh);
  scene.add(map);
  const selections = [];
  const controls = createMapControls({
    host,
    scene,
    map,
    renderer: { setSize() {} },
    cells: [{ key: '0,0', top: 0.5, g: mesh }],
    materials: { line: material, hover: material },
    draw() {
      scene.updateMatrixWorld(true);
    },
    onSelect: (key, options) => selections.push({ key, ...options }),
    onHover() {},
  });
  controls.refresh();
  t.after(() => {
    controls.dispose();
    mesh.geometry.dispose();
    material.dispose();
    globalThis.ResizeObserver = original;
  });
  return {
    selections,
    pointer(type, options = {}) {
      host.dispatchEvent(
        Object.assign(new Event(type), {
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX: 200,
          clientY: 200,
          ctrlKey: false,
          metaKey: false,
          ...options,
        }),
      );
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
    { key: '0,0', additive: true },
    { key: '0,0', additive: true },
    { key: '0,0', additive: false },
  ]);
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
