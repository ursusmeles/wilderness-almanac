import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { cropHeight, isVineyard } from '../src/generation/farmland-patches.js';
import { prepareMap } from '../src/generation/presentation.js';
import { campaignDressing, lockHex } from '../src/generation/campaign-world.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { validateHexEdits } from '../src/generation/hex-edits.js';
import { describeHex } from '../src/ui/map-link.js';
import { palettes, contrastRatio, hexToOklch } from '../src/palette.js';
import { createMapPalette } from '../src/map-palette.js';
import * as THREE from 'three';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createNatureBuilder } from '../src/rendering/nature-props.js';
import { clearGeometries } from '../src/rendering/geometry.js';

function farmlandWorld() {
  const world = generateWorld('farmland-variants');
  world.elevation.ranges = [];
  world.roads = undefined;
  for (const cell of world.cells)
    Object.assign(cell, {
      water: null,
      terrain: 'farmlands',
      elevation: Math.abs(cell.q) % 3,
      pointOfLight: null,
      pointsOfInterest: [],
      crossing: null,
      road: null,
    });
  return world;
}

test('farmland variants replay, retain terrain and use vineyards only above level zero', () => {
  const world = farmlandWorld(),
    before = structuredClone(world);
  const dressing = generateDressing(world);
  assert.deepEqual(dressing, generateDressing(world));
  assert.notDeepEqual(dressing, generateDressing(world, 1));
  assert.deepEqual(world, before);
  const styles = new Set();
  let trees = 0,
    fruit = 0,
    area = 0,
    oldArea = 0;
  const old = generateDressing({ ...world, generatorVersion: 8 });
  for (const [i, data] of dressing.cells.entries()) {
    const cell = world.cells[i];
    for (const prop of data.props) {
      if (prop.kind === 'crops') {
        styles.add(prop.cropStyle);
        area += prop.scale ** 2;
        if (prop.cropStyle === 'vineyard') assert.ok(cell.elevation > 0);
      }
      if (prop.kind === 'tree') {
        trees++;
        if (prop.fruit) {
          fruit++;
          assert.equal(prop.variant, 1);
        }
      }
    }
    oldArea += old.cells[i].props
      .filter((prop) => prop.kind === 'crops')
      .reduce((sum, prop) => sum + prop.scale ** 2, 0);
  }
  assert.deepEqual([...styles].sort(), ['grain', 'plots', 'vineyard']);
  assert.ok(area > oldArea * 1.05, 'Bigger plots cover more of the tile');
  assert.ok(
    trees > 70 && fruit / trees > 0.35 && fruit / trees < 0.65,
    'About half of farmland trees bear fruit',
  );
});

test('crop relief is low, returns to the base around its edge and leaves old plots flat', () => {
  for (const cropStyle of ['grain', 'vineyard']) {
    const prop = { cropStyle, detailSeed: 7 };
    assert.ok(cropHeight(prop, 0, 0) > 0.02 && cropHeight(prop, 0, 0) < 0.06);
    for (let i = -5; i <= 5; i++) {
      assert.ok(Math.abs(cropHeight(prop, i * 0.036, 0.2)) < 1e-10);
      assert.ok(Math.abs(cropHeight(prop, 0.18, i * 0.04)) < 1e-10);
    }
  }
  assert.equal(cropHeight({ detailSeed: 4 }, 0, 0), 0);
  assert.equal(cropHeight({ cropStyle: 'plots', detailSeed: 4 }, 0, 0), 0);
});

test('vineyard names and locked farmland props survive regeneration and JSON import', () => {
  const world = generateWorld('7');
  const dressing = generateDressing(world);
  const data = dressing.cells.find((cell) =>
    cell.props.some((prop) => prop.cropStyle === 'vineyard'),
  );
  assert.ok(data, 'Fixture has a vineyard');
  const tile = prepareMap(world, dressing).find((cell) => cell.key === data.key);
  assert.ok(isVineyard(tile));
  assert.match(describeHex(tile), /Vineyards/);
  assert.equal(isVineyard({ ...tile, terrain: 'meadow' }), false);
  const campaign = lockHex(
    createCampaign(world, palettes.forbidden, 'Forbidden Lands'),
    data.key,
    world,
    dressing,
  );
  const imported = importCampaign(exportCampaign({ ...campaign, variant: 2 }));
  assert.deepEqual(
    campaignDressing(imported, world).cells.find((cell) => cell.key === data.key).props,
    data.props,
  );
});

test('new dressing fields reject unbounded or incompatible imported values', () => {
  const prop = { kind: 'crops', x: 0, y: 0, z: 0, footprint: 0.3, cropStyle: 'vineyard' };
  const edits = (props, mountain) => ({
    version: 1,
    cells: { '0,0': { lock: { props, ...(mountain ? { mountain } : {}) } } },
  });
  assert.equal(validateHexEdits(edits([prop])).cells['0,0'].lock.props[0].cropStyle, 'vineyard');
  for (const bad of [
    { ...prop, cropStyle: 'unknown' },
    { ...prop, kind: 'house' },
    { ...prop, fruit: true },
    { ...prop, kind: 'tree', cropStyle: undefined, variant: 0, fruit: true },
  ])
    assert.throws(() => validateHexEdits(edits([bad])), /invalid hex edits/);
  assert.throws(
    () => validateHexEdits(edits([], { phase: 0, angle: 0, heightScale: 0.6, profile: 99 })),
    /invalid hex edits/,
  );
});

test('fruit remains colourful and contrasts with both foliage shades across palettes', () => {
  for (const seeds of [...Object.values(palettes), ['#aaaaaa', '#aaaaaa', '#aaaaaa']]) {
    const palette = createMapPalette(seeds);
    for (const tone of [0, 1, 2]) {
      const fruit = palette.role('fruit', 0, tone);
      assert.ok(hexToOklch(fruit)[1] > 0.08);
      for (const leaf of ['leaf', 'leafLight'])
        assert.ok(contrastRatio(fruit, palette.role(leaf)) > 1.4);
    }
  }
});

test('crop and fruit meshes have finite geometry inside their reserved footprints', () => {
  const registry = createMapMaterials(),
    group = new THREE.Group();
  const builder = createNatureBuilder(registry);
  const base = {
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    angle: 0,
    variant: 1,
    temperature: 0,
    detailSeed: 19,
    footprint: 0.28,
  };
  try {
    for (const cropStyle of ['plots', 'grain', 'vineyard']) {
      builder.makeCrops(group, { ...base, cropStyle });
      group.updateMatrixWorld(true);
      let vertices = 0;
      group.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const points = mesh.geometry.attributes.position;
        for (let i = 0; i < points.count; i++) {
          const point = new THREE.Vector3()
            .fromBufferAttribute(points, i)
            .applyMatrix4(mesh.matrixWorld);
          assert.ok(point.toArray().every(Number.isFinite));
          assert.ok(Math.hypot(point.x, point.z) <= base.footprint + 1e-6);
          assert.ok(point.y >= -0.001 && point.y < 0.25);
          vertices++;
        }
      });
      assert.ok(vertices > 100);
      clearGeometries(group);
    }
    builder.makeTree(group, { ...base, fruit: true });
    assert.ok(
      group.children[0].children.some(
        (mesh) =>
          mesh.material.userData.treeSway && mesh.material === registry.propMaterial('fruit', 0, 1),
      ),
    );
  } finally {
    clearGeometries(group);
    registry.dispose();
  }
});
