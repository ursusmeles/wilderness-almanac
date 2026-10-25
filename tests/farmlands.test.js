import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import {
  cropHeight,
  isVineyard,
  polygonArea,
  grainPlants,
  fieldInset,
  fieldDistance,
} from '../src/generation/farmland-patches.js';
import { generateGrainFields } from '../src/generation/grain-fields.js';
import { roadDistance, roadAllowsProp } from '../src/generation/road-geometry.js';
import { fitsHex } from '../src/generation/prop-placement.js';
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
    oldArea = 0,
    eligible = 0,
    vineyards = 0;
  const old = generateDressing({ ...world, generatorVersion: 8 });
  for (const [i, data] of dressing.cells.entries()) {
    validateHexEdits({ version: 1, cells: { [data.key]: { lock: data } } });
    const cell = world.cells[i];
    if (cell.elevation > 0) {
      eligible++;
      if (data.props.some((p) => p.cropStyle === 'vineyard')) vineyards++;
    }
    for (const prop of data.props) {
      if (prop.kind === 'crops') {
        styles.add(prop.cropStyle);
        area += prop.patch ? polygonArea(prop.patch) : 0.144 * prop.scale ** 2;
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
      .reduce((sum, prop) => sum + 0.144 * prop.scale ** 2, 0);
  }
  assert.deepEqual([...styles].sort(), ['grain', 'plots', 'vineyard']);
  assert.ok(area > oldArea * 1.05, 'Bigger plots cover more of the tile');
  assert.ok(
    vineyards / eligible > 0.13 && vineyards / eligible < 0.27,
    'Vineyards have about a 20% opportunity, leaving other styles more common',
  );
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

test('irregular grain fields cover the hex, fill their corners densely and clear reservations', () => {
  const poi = { kind: 'poi', x: 0.43, z: 0.14, footprint: 0.32 };
  const cell = {
    roads: [
      {
        width: 0.022,
        points: [
          [-0.82, 0],
          [-0.3, 0.04],
          [0, 0],
          [0.82, 0],
        ],
      },
    ],
  };
  const fields = generateGrainFields(cell, 19, [poi]);
  assert.deepEqual(fields, generateGrainFields(cell, 19, [poi]));
  assert.notDeepEqual(fields, generateGrainFields(cell, 20, [poi]));
  assert.ok(fields.length <= 24);
  let area = 0,
    plants = 0,
    nearEdge = false,
    large = false;
  for (const field of fields) {
    assert.equal(roadAllowsProp(cell.roads, field), true);
    area += polygonArea(field.patch);
    if (polygonArea(field.patch) > 0.25) large = true;
    assert.ok(fieldDistance(field, poi.x, poi.z) >= poi.footprint + 0.04);
    for (const [x, z] of field.patch) {
      const px = x + field.x,
        pz = z + field.z;
      assert.ok(fitsHex(px, pz, 0));
      assert.ok(roadDistance(cell.roads, px, pz) >= 0.066 - 1e-8);
      if (Math.hypot(px, pz) > 0.8) nearEdge = true;
      assert.ok(Math.abs(cropHeight(field, x, z)) < 1e-8);
    }
    for (const plant of grainPlants(field)) {
      assert.ok(fieldInset(field.patch, plant.x, plant.z) >= 0.019 - 1e-8);
      assert.ok(roadDistance(cell.roads, plant.x + field.x, plant.z + field.z) >= 0.066);
      plants++;
    }
  }
  assert.ok(
    area > 0.9 && nearEdge && large,
    'Broad fields occupy available tile edges despite a road and POI',
  );
  assert.ok(plants / area > 1500, 'High wheat density throughout the planted area');
  const rectangle = {
    cropStyle: 'grain',
    detailSeed: 4,
    patch: [
      [-0.18, -0.2],
      [0.18, -0.2],
      [0.18, 0.2],
      [-0.18, 0.2],
    ],
  };
  const dense = [...grainPlants(rectangle)];
  assert.ok(dense.length >= 256, 'Over four times the old 64 stalks on the same area');
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ])
    assert.ok(
      dense.some((p) => p.x * sx > 0.12 && p.z * sz > 0.14),
      'Every patch corner is planted',
    );
});

test('golden fields follow ramp heights and road checks use the actual outline', () => {
  const registry = createMapMaterials(),
    group = new THREE.Group();
  const builder = createNatureBuilder(registry);
  const prop = {
    kind: 'crops',
    cropStyle: 'grain',
    patch: [
      [-0.1, -0.15],
      [0.1, -0.15],
      [0.1, 0.15],
      [-0.1, 0.15],
    ],
    x: 0.5,
    y: 0.05,
    z: 0,
    footprint: 0.8,
    scale: 1,
    angle: 0,
    detailSeed: 1,
    temperature: 0,
  };
  const cell = {
    elevation: 1,
    roadSurface: {
      vertices: [
        [-1, 0.46, -1],
        [1, 0.66, -1],
        [1, 0.66, 1],
        [-1, 0.46, 1],
      ],
      topTriangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
  };
  try {
    builder.makeCrops(group, prop, cell);
    group.updateMatrixWorld(true);
    const ground = group.children[0].children[0];
    const position = ground.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(ground.matrixWorld);
      assert.ok(Math.abs(p.y - (p.x * 0.1 + cropHeight(prop, p.x - prop.x, p.z) + 0.004)) < 1e-7);
    }
    assert.equal(
      roadAllowsProp(
        [
          {
            width: 0.022,
            points: [
              [0, -1],
              [0, 1],
            ],
          },
        ],
        prop,
      ),
      true,
      'An oversized bounding circle must not erase a distant field',
    );
    assert.equal(
      roadAllowsProp(
        [
          {
            width: 0.022,
            points: [
              [0.5, -1],
              [0.5, 1],
            ],
          },
        ],
        prop,
      ),
      false,
      'A crossing road intersects the field',
    );
  } finally {
    clearGeometries(group);
    registry.dispose();
  }
});

test('irregular crop outlines validate and remain exact through locks and import', () => {
  const world = generateWorld('7'),
    dressing = generateDressing(world);
  const data = dressing.cells.find((cell) => cell.props.some((p) => p.patch));
  assert.ok(data);
  const campaign = lockHex(
    createCampaign(world, palettes.forbidden, 'Forbidden Lands'),
    data.key,
    world,
    dressing,
  );
  const imported = importCampaign(exportCampaign({ ...campaign, variant: 2 }));
  assert.deepEqual(
    campaignDressing(imported, world).cells.find((c) => c.key === data.key).props,
    data.props,
  );
  const valid = {
    kind: 'crops',
    cropStyle: 'grain',
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    angle: 0,
    footprint: 0.5,
    patch: [
      [-0.3, -0.3],
      [0.3, -0.3],
      [0.3, 0.3],
      [-0.3, 0.3],
    ],
  };
  const edits = (p) => ({ version: 1, cells: { '0,0': { lock: { props: [p] } } } });
  assert.deepEqual(validateHexEdits(edits(valid)).cells['0,0'].lock.props[0].patch, valid.patch);
  for (const patch of [
    [],
    Array(25).fill([0, 0]),
    [
      [0, 0],
      [NaN, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [0.2, 0],
      [0.1, 0],
    ],
    [
      [-0.3, -0.3],
      [-0.3, 0.3],
      [0.3, 0.3],
      [0.3, -0.3],
    ],
    [
      [0, 0],
      [2, 0],
      [0, 2],
    ],
  ])
    assert.throws(() => validateHexEdits(edits({ ...valid, patch })), /invalid hex edits/);
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
    for (const variant of [
      { cropStyle: 'plots' },
      { cropStyle: 'grain' },
      { cropStyle: 'vineyard' },
      {
        cropStyle: 'grain',
        patch: [
          [-0.18, -0.2],
          [0.18, -0.16],
          [0.13, 0.2],
          [-0.18, 0.15],
        ],
      },
    ]) {
      builder.makeCrops(group, { ...base, ...variant });
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
      if (variant.patch) {
        assert.equal(
          group.children[0].children[0].material.userData.treeSway,
          undefined,
          'The golden ground stays still while stalks sway',
        );
        assert.ok(vertices > 2000, 'Dense grain remains batched into a few meshes');
        assert.equal(group.children[0].children.length, 3);
      }
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
