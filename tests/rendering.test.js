import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';

// Captured from the renderer before extraction. Check actual buffers, transforms,
// material settings, wind attributes and picking ranges without a WebGL context.
function meshDigest(group) {
  const hash = createHash('sha256');
  let meshes = 0,
    vertices = 0;
  const json = (value) => hash.update(JSON.stringify(value));
  group.updateMatrixWorld(true);
  group.traverse((object) => {
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    vertices += geometry.attributes.position.count;
    json([
      object.matrixWorld.elements,
      object.castShadow,
      object.receiveShadow,
      Boolean(object.customDepthMaterial),
      object.userData,
      geometry.groups,
    ]);
    for (const name of Object.keys(geometry.attributes).sort()) {
      const attr = geometry.attributes[name];
      json([name, attr.itemSize, attr.normalized, attr.array.constructor.name]);
      hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
    }
    if (geometry.index)
      hash.update(
        Buffer.from(
          geometry.index.array.buffer,
          geometry.index.array.byteOffset,
          geometry.index.array.byteLength,
        ),
      );
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      json([
        material.type,
        material.color?.toArray(),
        material.side,
        material.flatShading,
        material.roughness,
        material.metalness,
        material.transparent,
        material.opacity,
        material.depthWrite,
        material.userData,
      ]);
  });
  return { meshes, vertices, digest: hash.digest('hex') };
}
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/rendering.json', import.meta.url)));
for (const { seed, variant, colors, expected } of fixtures)
  test(`rendered geometry, colours and picking metadata match the original renderer: seed ${seed}`, () => {
    const world = generateWorld(seed, { generatorVersion: 7 });
    const registry = createMapMaterials();
    const meshes = createMapMeshes(registry);
    try {
      registry.setPalette(colors);
      meshes.setMap(prepareMap(world, generateDressing(world, variant)));
      assert.deepEqual(meshDigest(meshes.group), expected);
      registry.setPalette(['#322333', '#2a6775', '#ed8965']);
      registry.setPalette(colors);
      assert.deepEqual(
        meshDigest(meshes.group),
        expected,
        'recolouring preserves geometry and cached tints',
      );
    } finally {
      meshes.dispose();
      registry.dispose();
    }
  });

test('rebuilds release old geometry once, retain shared materials, and dispose their owned resources', () => {
  const world = generateWorld('7');
  const layout = prepareMap(world, generateDressing(world, 0)).slice(0, 4);
  const registry = createMapMaterials();
  const meshes = createMapMeshes(registry);
  const watch = (resources) =>
    new Map(
      [...new Set(resources)].map((resource) => {
        const count = { value: 0 };
        resource.addEventListener('dispose', () => count.value++);
        return [resource, count];
      }),
    );
  const geometries = () => {
    const found = [];
    meshes.group.traverse((object) => {
      if (object.geometry) found.push(object.geometry);
    });
    return found;
  };
  meshes.setMap(layout);
  const oldGeometry = watch(geometries());
  const tinted = registry.propMaterial('leaf', 0.2, 1);
  const materials = watch([...Object.values(registry.materials), registry.treeDepth, tinted]);
  meshes.setMap(layout);
  assert.ok([...oldGeometry.values()].every((count) => count.value === 1));
  assert.ok([...materials.values()].every((count) => count.value === 0));
  const currentGeometry = watch(geometries());
  meshes.dispose();
  registry.dispose();
  assert.ok([...currentGeometry.values()].every((count) => count.value === 1));
  assert.ok([...materials.values()].every((count) => count.value === 1));
  assert.equal(meshes.group.children.length, 0);
  assert.equal(meshes.cells.length, 0);
});
