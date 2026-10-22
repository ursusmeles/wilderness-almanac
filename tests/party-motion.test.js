import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPartyToken, partyNudgeAngle } from '../src/rendering/party-token.js';

function fixture(t, reduced = false) {
  const originals = Object.fromEntries(
    ['document', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const frames = new Map();
  let id = 0;
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.matchMedia = () => Object.assign(new EventTarget(), { matches: reduced });
  globalThis.requestAnimationFrame = (callback) => (frames.set(++id, callback), id);
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const host = {
    dataset: {},
    style: { removeProperty() {} },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
    }),
  };
  const moves = [];
  const token = createPartyToken({ host, draw() {}, onMove: (key) => moves.push(key) });
  token.set({ key: '0,0', style: 'warden', color: '#00ffff' }, [
    { key: '0,0', top: 0, g: new THREE.Group() },
  ]);
  let root;
  token.render({ clearDepth() {}, render: (scene) => (root = scene.children[0]) });
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(6, 8, 10);
  camera.lookAt(root.position);
  camera.updateMatrixWorld(true);
  const point = root.position
    .clone()
    .add(new THREE.Vector3(0, 0.035, 0))
    .project(camera);
  const event = { clientX: (point.x + 1) * 200, clientY: (1 - point.y) * 200 };
  t.after(() => {
    token.dispose();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return {
    token,
    root,
    camera,
    event,
    moves,
    tick(time) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
    frames,
  };
}

test('nudge sways right, rebounds one fifth as far left and finishes upright', () => {
  assert.equal(partyNudgeAngle(0), 0);
  assert.equal(partyNudgeAngle(0.28), 0.09);
  assert.ok(Math.abs(partyNudgeAngle(0.66) + 0.018) < 1e-10);
  assert.equal(partyNudgeAngle(1), 0);
});

test('click nudge stays grounded, follows camera right and does not place the party', (t) => {
  const { token, root, camera, event, moves, tick, frames } = fixture(t);
  const initial = root.position.clone();
  assert.equal(token.start(event, camera), true);
  token.end(event, () => assert.fail('a click must not hit-test a destination'));
  const start = performance.now();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const sway = () => new THREE.Vector3(0, 1, 0).applyEuler(root.rotation).dot(right);
  tick(start + 112);
  assert.ok(sway() > 0.08);
  assert.ok(root.position.equals(initial));
  tick(start + 264);
  assert.ok(sway() < -0.01);
  assert.ok(root.position.equals(initial));
  tick(start + 410);
  assert.equal(Math.abs(root.rotation.x), 0);
  assert.equal(Math.abs(root.rotation.z), 0);
  assert.equal(frames.size, 0);
  assert.deepEqual(moves, []);
});

test('drag release retains its drop and placement callback', (t) => {
  const { token, root, camera, event, moves, tick } = fixture(t);
  const initialY = root.position.y;
  assert.equal(token.start(event, camera), true);
  const destination = { ...event, clientX: event.clientX + 25 };
  token.move(destination, camera);
  token.end(destination, () => '0,0');
  tick(performance.now() + 10);
  assert.ok(root.position.y > initialY + 0.2);
  assert.deepEqual(moves, ['0,0']);
});

test('reduced motion leaves a clicked piece upright and grounded', (t) => {
  const { token, root, camera, event, tick, frames } = fixture(t, true);
  const initial = root.position.clone();
  assert.equal(token.start(event, camera), true);
  token.end(event, () => assert.fail('a click must not move'));
  tick(performance.now() + 112);
  assert.ok(root.position.equals(initial));
  assert.equal(root.rotation.x, 0);
  assert.equal(root.rotation.z, 0);
  assert.equal(frames.size, 0);
});
