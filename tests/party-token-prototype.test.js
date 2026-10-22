import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyRoute } from '../prototypes/party-token-model.js';
import { createPartyPiece } from '../prototypes/party-token-mesh.js';

const cells = [
  { key: '0,0', q: 0, r: 0 },
  { key: '1,0', q: 1, r: 0, pointOfLight: { type: 'village' } },
  { key: '3,0', q: 3, r: 0, pointOfLight: { type: 'city' } },
];
test('party starts at the nearest settlement and visits only placed hexes', () => {
  const route = createPartyRoute(cells);
  assert.equal(route.current.key, '1,0');
  assert.deepEqual([...route.visited], ['1,0']);
  assert.equal(route.neighbour(3).key, '0,0');
  assert.equal(route.move('0,0'), true);
  route.move('1,0');
  assert.equal(route.move('missing'), false);
  assert.equal(route.current.key, '1,0');
  assert.deepEqual([...route.visited], ['1,0', '0,0']);
  assert.equal(createPartyRoute(cells.map(({ pointOfLight, ...cell }) => cell)).current.key, '0,0');
});
test('all three pawn approaches have finite mesh vertices and dispose owned resources', () => {
  for (let style = 0; style < 3; style++) {
    const piece = createPartyPiece(style);
    let count = 0,
      disposed = 0;
    piece.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      count++;
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      mesh.geometry.addEventListener('dispose', () => disposed++);
    });
    assert.ok(count > 8);
    piece.dispose();
    assert.equal(disposed, count);
  }
});
