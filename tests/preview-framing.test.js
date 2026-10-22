import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitPreviewCamera } from '../src/rendering/preview-framing.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';

function camera() {
  const value = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 180);
  value.position.set(24, 30, 37);
  value.lookAt(0, 0.3, 0);
  return value;
}

function assertFramed(view, root) {
  const bounds = new THREE.Box3();
  root.traverseVisible((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(object.matrixWorld)
        .project(view);
      assert.ok(Math.abs(point.x) <= 1 / 1.08 + 1e-6, 'horizontal preview padding');
      assert.ok(Math.abs(point.y) <= 1 / 1.08 + 1e-6, 'vertical preview padding');
      assert.ok(Math.abs(point.z) < 1, 'inside depth clipping planes');
      bounds.expandByPoint(point);
    }
  });
  const centre = bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(centre.x) < 1e-6 && Math.abs(centre.y) < 1e-6, 'centred projected content');
}

test('raised forests, settlements, POIs and mountain tiles fit completely in Inspector previews', () => {
  const world = generateWorld('7');
  const layout = prepareMap(world, generateDressing(world, 0));
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const samples = [
    layout.find((tile) => tile.props.some((p) => p.kind === 'tree')),
    layout.find((tile) => tile.props.some((p) => p.kind === 'house')),
    layout.find((tile) => tile.props.some((p) => p.kind === 'poi')),
    layout.find((tile) => tile.surface),
  ];
  try {
    const view = camera();
    for (const tile of samples) {
      assert.ok(tile);
      // Also cover high imported/edited terrain carrying the same tall props.
      for (const top of [tile.top, 1.5]) {
        meshes.setMap([{ ...tile, q: 0, r: 0, top }]);
        for (const aspect of [1, 0.75, 1.5]) {
          assert.ok(fitPreviewCamera(view, meshes.group, aspect));
          assertFramed(view, meshes.group);
        }
      }
    }
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});

test('fitting recentres off-axis tall props without rotating the camera or accumulating zoom', () => {
  const view = camera();
  const rotation = view.quaternion.clone();
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(0.8, 2, -0.6);
  root.add(mesh);
  try {
    for (let i = 0; i < 3; i++) {
      view.zoom = 4.1;
      assert.ok(fitPreviewCamera(view, root, 1));
      assertFramed(view, root);
      assert.equal(view.zoom, 1);
      assert.ok(view.quaternion.equals(rotation));
    }
    const before = view.projectionMatrix.clone();
    assert.equal(fitPreviewCamera(view, new THREE.Group(), 1), false);
    assert.ok(view.projectionMatrix.equals(before));
  } finally {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
