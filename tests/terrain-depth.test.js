import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createTerrainBuilder } from '../src/rendering/terrain-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';

const world = generateWorld('1234-mw');
const dressing = generateDressing(world, 0);

test('water depth agrees at shared shoreline vertices and preserves world/dressing data', () => {
  const original = JSON.stringify({ world, dressing });
  const layout = prepareMap(world, dressing);
  const samples = new Map();
  let shared = 0;
  const depths = [];
  for (const tile of layout.filter((tile) => tile.water)) {
    for (const [x, depth, z] of tile.waterDepth.vertices) {
      assert.ok(depth >= 0 && depth <= 1);
      const key = `${(tile.wx + x).toFixed(6)},${(tile.wz + z).toFixed(6)}`;
      if (samples.has(key)) {
        assert.ok(Math.abs(samples.get(key) - depth) < 1e-10);
        shared++;
      } else samples.set(key, depth);
      depths.push(depth);
    }
  }
  assert.ok(shared > 30);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.5);
  assert.equal(JSON.stringify({ world, dressing }), original);
});

test('cropped and recentered water previews retain full-map depth colouring', () => {
  const layout = prepareMap(world, dressing);
  const tile = layout.find((tile) => tile.water === 'ocean' && !tile.riverSurface);
  const [cropped] = prepareMap(world, dressing, { cellKeys: [tile.key] });
  assert.deepEqual(cropped.waterDepth, tile.waterDepth);
  const registry = createMapMaterials();
  const makeTerrain = createTerrainBuilder(registry);
  const full = makeTerrain(tile);
  const preview = makeTerrain({ ...cropped, q: 0, r: 0 });
  try {
    const water = ({ content }) =>
      content.children.find((mesh) => mesh.material?.userData.pixelTerrain?.kind === 'water');
    assert.deepEqual(
      water(full).geometry.attributes.color.array,
      water(preview).geometry.attributes.color.array,
    );
    assert.deepEqual(
      water(full).geometry.attributes.uv.array,
      water(preview).geometry.attributes.uv.array,
    );
  } finally {
    for (const { g } of [full, preview]) g.traverse((o) => o.geometry?.dispose());
    registry.dispose();
  }
});
