import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { evergreenAtlas } from '../src/rendering/pixel-evergreens.js';
import { deciduousAtlas } from '../src/rendering/pixel-deciduous.js';

function keyFor(mesh, face) {
  return mesh.userData.faceRanges.find(({ end }) => face < end)?.key;
}
function hitTriangle(mesh, triangle) {
  const geometry = mesh.geometry;
  const vertices = [0, 1, 2].map((corner) =>
    new THREE.Vector3().fromBufferAttribute(
      geometry.attributes.position,
      geometry.index.getX(triangle * 3 + corner),
    ),
  );
  const normal = new THREE.Triangle(...vertices).getNormal(new THREE.Vector3());
  const center = vertices
    .reduce((point, vertex) => point.add(vertex), new THREE.Vector3())
    .divideScalar(3);
  const ray = new THREE.Raycaster(
    center.addScaledVector(normal, 0.0001),
    normal.negate(),
    0,
    0.0002,
  );
  return ray.intersectObject(mesh, false)[0];
}

test('every tree variant retains a bounded, nonempty coarse 3D crown', () => {
  for (const atlas of [evergreenAtlas(), deciduousAtlas()]) {
    for (const [key, crown] of atlas.crowns) {
      if (key.endsWith(':far')) continue;
      const far = atlas.crowns.get(`${key}:far`);
      assert.ok(far.indices.length > 0 && far.indices.length < crown.indices.length, key);
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = (points) => points.filter((_, index) => index % 3 === axis);
        const full = coordinate(crown.points),
          coarse = coordinate(far.points);
        // At most one coarse voxel of silhouette tolerance at subpixel scale.
        assert.ok(Math.abs(Math.min(...full) - Math.min(...coarse)) < 0.11, `${key}: min ${axis}`);
        assert.ok(Math.abs(Math.max(...full) - Math.max(...coarse)) < 0.11, `${key}: max ${axis}`);
      }
      assert.ok(far.indices.every((index) => index >= 0 && index < far.points.length / 3));
      assert.ok(far.uvs.every((value) => value >= 0 && value <= 1));
    }
  }
});

test('forest LOD preserves picking, shadow state, wind bounds and resource ownership', () => {
  const world = generateWorld('Thorned woods', { preferences: { forests: 2 } });
  const layout = prepareMap(world, generateDressing(world, 0)).filter(
    ({ q, r }) => Math.abs(q) <= 3 && Math.abs(r) <= 3,
  );
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry, { artStyle: 'pixelart' });
  const camera = new THREE.OrthographicCamera(-26, 26, 19.5, -19.5);
  const renderer = { domElement: { width: 960 } };
  const watched = new Map();
  try {
    meshes.setMap(layout);
    meshes.group.updateMatrixWorld(true);
    const crowns = [];
    meshes.group.traverse((mesh) => {
      if (mesh.geometry) {
        watched.set(mesh.geometry, 0);
        mesh.geometry.addEventListener('dispose', () =>
          watched.set(mesh.geometry, watched.get(mesh.geometry) + 1),
        );
      }
      if (mesh.userData.foliageLOD) crowns.push(mesh);
    });
    assert.ok(crowns.length > 0);
    for (const mesh of crowns) {
      const { near, far } = mesh.userData.foliageLOD,
        geometry = mesh.geometry;
      const originalIndex = geometry.index;
      mesh.onBeforeRender(renderer, null, camera);
      assert.deepEqual(geometry.drawRange, far);
      const farHit = hitTriangle(mesh, far.start / 3);
      assert.ok(farHit, 'coarse crown remains pickable');
      assert.equal(
        keyFor(mesh, farHit.faceIndex),
        mesh.userData.faceRanges.find(({ end }) => end > far.start / 3).key,
      );
      camera.zoom = 5;
      mesh.onBeforeRender(renderer, null, camera);
      assert.deepEqual(geometry.drawRange, near);
      const nearHit = hitTriangle(mesh, 0);
      assert.ok(nearHit, 'detailed crown remains pickable');
      assert.equal(keyFor(mesh, nearHit.faceIndex), mesh.userData.faceRanges[0].key);
      mesh.onBeforeShadow();
      assert.deepEqual(geometry.drawRange, far);
      mesh.onAfterShadow();
      assert.deepEqual(geometry.drawRange, near);
      assert.equal(
        geometry.index,
        originalIndex,
        'switching does not allocate/upload an index buffer',
      );
      assert.equal(mesh.userData.faceRanges.at(-1).end * 3, originalIndex.count);
      for (let index = 0; index < geometry.attributes.swayWeight.count; index++) {
        const weight = geometry.attributes.swayWeight.getX(index);
        assert.ok(weight >= 0 && weight <= 1);
      }
      camera.zoom = 1;
    }
    registry.setTimeOfDay('night');
    registry.setPalette(['#322333', '#2a6775', '#ed8965']);
    assert.ok([...watched.values()].every((count) => count === 0));
  } finally {
    meshes.dispose();
    registry.dispose();
  }
  assert.ok([...watched.values()].every((count) => count === 1));
});
