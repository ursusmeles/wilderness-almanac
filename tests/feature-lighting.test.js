import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFeatureLighting, lighthouseTarget } from '../src/rendering/feature-lighting.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createFogView } from '../src/application/fog-view.js';

const land = { key: '0,0', q: 0, r: 0, top: 0.5, terrain: 'meadow' };
const sea = { key: '1,0', q: 1, r: 0, top: 0.2, terrain: 'open water', water: 'ocean' };
const source = (kind = 'warm', tile = land) => ({
  kind,
  tile,
  position: [0, 0.3, 0.05],
  size: [0.07, 0.09],
  matrix: new THREE.Matrix4().makeTranslation(0, 0.5, 0),
});
function camera() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 5, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

test('all night glows are batched, native light counts are bounded and modes reuse resources', () => {
  const scene = new THREE.Scene(),
    lighting = createFeatureLighting(scene),
    view = camera();
  const entries = Array.from({ length: 300 }, (_, i) =>
    source(['warm', 'mystic', 'dungeon'][i % 3]),
  );
  const before = structuredClone(entries.map(({ matrix, ...entry }) => entry));
  lighting.setSources(entries, [land, sea]);
  const geometry = lighting.group.children.map((mesh) => mesh.geometry);
  assert.equal(lighting.group.children.length, 6);
  assert.equal(lighting.points.length, 4);
  assert.equal(lighting.beams.length, 2);
  assert.ok([...lighting.points, ...lighting.beams].every((light) => !light.castShadow));
  lighting.update(0, view);
  assert.equal(lighting.group.visible, false);
  assert.ok(lighting.points.every((light) => light.intensity === 0));
  assert.ok([...lighting.points, ...lighting.beams].every((light) => !light.visible));
  lighting.setMode('night');
  lighting.update(0, view);
  assert.equal(lighting.group.visible, true);
  const initial = lighting.points[0].intensity;
  lighting.update(3, view);
  assert.notEqual(lighting.points[0].intensity, initial);
  lighting.setMode('day');
  lighting.update(3, view);
  assert.deepEqual(
    lighting.group.children.map((mesh) => mesh.geometry),
    geometry,
  );
  assert.deepEqual(
    entries.map(({ matrix, ...entry }) => entry),
    before,
  );
  let disposed = 0;
  geometry.forEach((item) => item.addEventListener('dispose', () => disposed++));
  lighting.setSources([], []);
  assert.equal(disposed, geometry.length);
  lighting.dispose();
  assert.equal(scene.children.length, 0);
});

test('every lighthouse gets a sweeping beam toward open water while native spotlights stay capped', () => {
  const scene = new THREE.Scene(),
    lighting = createFeatureLighting(scene),
    view = camera();
  lighting.setSources(
    Array.from({ length: 4 }, () => source('lighthouse')),
    [land, sea],
  );
  assert.equal(lighting.beamGroup.children.length, 4);
  lighting.setMode('night');
  lighting.update(0, view);
  const original = lighting.beams[0].target.position.clone();
  assert.ok(original.x > 1);
  lighting.update(5, view);
  assert.notDeepEqual(lighting.beams[0].target.position, original);
  assert.ok(lighting.beams[0].target.position.distanceTo(original) <= 0.31);
  lighting.setMode('day');
  lighting.update(5, view);
  assert.equal(lighting.beamGroup.visible, false);
  assert.ok(lighting.beams.every((light) => light.intensity === 0));
  lighting.dispose();
});

test('unseen coastline and fogged sources emit no light', () => {
  const origin = new THREE.Vector3(0, 0.8, 0);
  assert.equal(lighthouseTarget(origin, [land]), null);
  assert.equal(lighthouseTarget(origin, [land, { ...sea, fogState: 'undiscovered' }]), null);
  assert.ok(lighthouseTarget(origin, [land, sea]));
  assert.equal(
    lighthouseTarget(origin, [
      land,
      { ...sea, fogState: 'undiscovered' },
      { ...sea, q: 2, key: '2,0' },
    ]),
    null,
    'beams cannot cross a hidden hex to reach visible water',
  );
  const scene = new THREE.Scene(),
    lighting = createFeatureLighting(scene);
  lighting.setSources(
    [
      source('mystic', { ...land, fogState: 'undiscovered' }),
      source('lighthouse', { ...land, fogState: 'unvisited' }),
    ],
    [land, sea],
  );
  lighting.setMode('night');
  lighting.update(0, camera());
  assert.equal(lighting.group.children.length, 0);
  assert.equal(lighting.beamGroup.children.length, 0);
  assert.ok(lighting.points.every((light) => light.intensity === 0));
  lighting.dispose();
});

test('source positions follow actual model transforms and the fog projection without changing dressing', () => {
  const world = generateWorld('7'),
    dressing = generateDressing(world, 0);
  const layout = prepareMap(world, dressing),
    saved = JSON.stringify(layout);
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry);
  meshes.setMap(layout);
  assert.deepEqual(
    new Set(meshes.lightSources.map((light) => light.kind)),
    new Set(['warm', 'lighthouse', 'mystic', 'dungeon']),
  );
  for (const light of meshes.lightSources) {
    const position = new THREE.Vector3().fromArray(light.position).applyMatrix4(light.matrix);
    assert.ok(position.toArray().every(Number.isFinite));
    assert.ok(position.y > light.tile.top);
  }
  const key = meshes.lightSources[0].tile.key;
  const states = new Map(
    world.cells.map((cell) => [cell.key, cell.key === key ? 'visited' : 'undiscovered']),
  );
  meshes.setMap(createFogView(world, layout, states).layout);
  assert.ok(meshes.lightSources.length > 0);
  assert.ok(meshes.lightSources.every((light) => light.tile.key === key));
  assert.equal(JSON.stringify(layout), saved);
  meshes.dispose();
  registry.dispose();
});
